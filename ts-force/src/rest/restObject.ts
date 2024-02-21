import {
  BatchResponse,
  Composite,
  CompositeBatch,
  CompositeBatchResult,
  CompositeResponse,
  CompositeResult,
  queryAllComposite,
} from './composite';
import { Rest } from './rest';
import { getSFieldProps, SalesforceFieldType, SFieldProperties } from './sObjectDecorators';
import { SObject } from './sObject';
import { CompositeError, StandardRestError } from './errors';
import { FieldProps } from '..';
import { CalendarDate, calendarToString, getCalendarDate } from '../utils/calendarDate';
import { RawAxiosRequestHeaders, AxiosHeaders } from 'axios';

export interface DMLResponse {
  id: string;
  errors: string[];
  success: boolean;
  warnings: string[];
}

export type SforceAutoAssignHeader = 'TRUE' | 'FALSE';
export type SforceCallOptionsHeader = {
  client?: string;
  defaultNamespace?: string;
};
export type ContentEncodingHeader = 'gzip' | 'deflate';
export type ETagHeader = string;
export type IfMatchHeader = string[];
export type IfNoneMatchHeader = string[];
export type IfModifiedSinceHeader = Date;
export type IfUnmodifiedSinceHeader = Date;
export type SforceDuplicateRuleHeader = {
  allowSave?: boolean;
  includeRecordDetails?: boolean;
  runAsCurrentUser?: boolean;
};
export type SforceMruHeader = {
  updateMru: boolean;
};
export type SforceQueryOptionsHeader = {
  batchSize: number;
};
export type PackageVersionHeader = {
  package: string;
  version: string;
};

export type RequestHeadersInput = {
  'Sforce-Auto-Assign'?: SforceAutoAssignHeader;
  'Sforce-Call-Options'?: SforceCallOptionsHeader;
  'Content-Encoding'?: ContentEncodingHeader;
  ETag?: ETagHeader;
  'Sforce-Duplicate-Rule-Header'?: SforceDuplicateRuleHeader;
  'Sforce-Mru'?: SforceMruHeader;
  'Sforce-Query-Options'?: SforceQueryOptionsHeader;
  'x-sfdc-packageversion'?: PackageVersionHeader;
  'If-Modified-Since'?: IfModifiedSinceHeader;
  'If-Unmodified-Since'?: IfUnmodifiedSinceHeader;
  'If-Match'?: IfMatchHeader;
  'If-None-Match'?: IfNoneMatchHeader;
};

export const GetOrHeadRequestHeaders = ['If-Match', 'If-None-Match', 'If-Modified-Since'];
export const PatchOrPostRequestHeaders = ['If-Match', 'If-None-Match', 'If-Unmodified-Since'];

export interface QueryOpts {
  /* Optional rest instance to use */
  restInstance?: Rest;
  /* Use 'queryAll' endpoint (retrieves deleted records) */
  allRows?: boolean;
  /* Use Composite API to minimize number of API calls */
  useComposite?: boolean;
  /* Follow all query locators. Defaults to 'parent-only'. 
    NOTE: this only will query 1 level deep (not sure SF returns deeper than that anyway?)
  */
  allRecords?: false | true | 'parent-only';
}

const NAME_MAP_CACHE = new Map<symbol, Map<string, string>>();

/**
 * Abstract Base class which provides DML to Generated SObjects
 * TODO: Need some way to support multiple configurations
 * @export
 * @abstract
 * @class RestObject
 * @extends {SObject}
 */
export abstract class RestObject extends SObject {
  private _client: Rest;

  public _modified = new Set<string>();

  constructor(type: string, client?: Rest) {
    super(type, client);
    this._client = client || new Rest();
  }

  protected initObject(fields?: Partial<FieldProps<RestObject>>) {
    if (fields) {
      if (fields instanceof RestObject) {
        this._modified = fields._modified ?? new Set<string>();
      } else {
        this.setModified(Object.keys(fields) as any);
      }
    }
    Object.assign(this, fields);
  }

  // handler used when proxied
  protected safeUpdateProxyHandler = {
    set: (obj: any, key: keyof any, value: any) => {
      obj[key] = value;
      if (typeof key === 'string') {
        let decorator = getSFieldProps(obj, key);
        if (decorator && decorator.updateable) {
          obj._modified.add(decorator.apiName);
        }
      }
      return true;
    },
  };

  // returns ALL records of a query
  protected static async query<T extends RestObject>(type: { new (): T }, qry: string, opts?: QueryOpts): Promise<T[]> {
    opts = opts || {};

    const { restInstance, allRows, useComposite, allRecords = 'parent-only' } = opts;
    let client = restInstance || new Rest();
    let records: SObject[] = [];

    if (useComposite) {
      records = await queryAllComposite(qry, { restInstance: client, allRows });
    } else {
      let response = await client.query<T>(qry, allRows);
      records = response.records;
      if (allRecords === true || allRecords === 'parent-only') {
        while (!response.done && response.nextRecordsUrl) {
          response = await client.queryMore<T>(response);
          records = records.concat(response.records);
        }
      }
    }

    if (allRecords === true) {
      // SF inner queries have query locators that might not return all the data
      // There should be maybe be an option to enable/disable this as it could run A LOT of queries
      for (const rec of records) {
        // check if any of the properties have query locators
        for (const prop in rec) {
          if (rec.hasOwnProperty(prop)) {
            const data = rec[prop];
            if (data && typeof data === 'object' && 'records' in data && 'done' in data && 'nextRecordsUrl' in data) {
              let innerResponse = data;
              let innerRecords = data.records;
              while (!innerResponse.done && innerResponse.nextRecordsUrl) {
                innerResponse = await client.queryMore<any>(innerResponse);
                innerRecords = innerRecords.concat(innerResponse.records);
              }
              rec[prop].records = innerRecords;
            }
          }
        }
      }
    }

    let sobs: Array<T> = records.map((rec) => {
      let sob = new type();
      sob._client = client;
      sob.mapFromQuery(rec);
      return sob;
    });

    return sobs;
  }

  protected static getPropertiesMeta<S, T extends RestObject>(type: { new (): T }): { [P in keyof FieldProps<S>]: SFieldProperties } {
    let properties: any = {};
    let sob = new type();
    for (let i in sob) {
      // clean properties
      if (sob.hasOwnProperty(i)) {
        let sFieldProps = getSFieldProps(sob, i);
        if (sFieldProps) {
          properties[i] = sFieldProps;
        }
      }
    }
    return properties;
  }

  handleCompositeUpdateResult = (result: CompositeResponse) => {
    this.id = result.body.id;
  };

  handleCompositeGetResult = (result: CompositeResponse) => {
    this.mapFromQuery(result.body);
  };

  handleCompositeBatchGetResult = (result: CompositeBatchResult<SObject, any>) => {
    this.mapFromQuery(result.result);
  };

  public async refresh(): Promise<this> {
    if (this.id == null) {
      throw new Error('Must have Id to refresh!');
    }

    let response = (await this._client.request.get(`${this.attributes.url}/${this.id}`)).data;

    this.mapFromQuery(response);
    return this;
  }

  /**
   * inserts the sobject to Salesfroce
   *
   * @param {boolean} [refresh] Set to true to apply GET after update
   * @returns {Promise<void>}
   * @memberof RestObject
   */
  public async insert(opts?: { refresh?: boolean }): Promise<this> {
    opts = opts || {};
    const { refresh } = opts;

    if (refresh === true) {
      return this.insertComposite();
    } else {
      let response = (await this._client.request.post(`${this.attributes.url}/`, this.toJson({ dmlMode: 'insert' }))).data;
      this.id = response.id;
      this._modified.clear();
    }
    return this;
  }

  protected async insertComposite(): Promise<this> {
    let insertCompositeRef = 'newObject';

    let composite = new Composite(this._client).addRequest(
      {
        method: 'POST',
        url: this.attributes.url,
        referenceId: insertCompositeRef,
        body: this.toJson({ dmlMode: 'insert' }),
      },
      this.handleCompositeUpdateResult
    );

    composite.addRequest(
      {
        method: 'GET',
        url: `${this.attributes.url}/@{${insertCompositeRef}.id}`,
        referenceId: 'getObject',
      },
      this.handleCompositeGetResult
    );

    const compositeResult = await composite.send();
    this.handleCompositeErrors(compositeResult);
    this._modified.clear();
    return this;
  }

  /**
   * Updates the sObject on Salesforce
   * @param {boolean} [refresh] Set to true to apply GET after update
   * @param {Date} [ifModifiedSince] Set If-Modified-Since conditional header - has no effect if refresh=true
   * @param {Date} [ifUnmodifiedSince] Set If-Modified-Since conditional header - has no effect if refresh=true
   * @returns {Promise<void>}
   * @memberof RestObject
   */
  public async update(opts?: { refresh?: boolean; sendAllFields?: boolean; headers?: RequestHeadersInput }): Promise<this> {
    opts = opts || {};
    if (this.id == null) {
      throw new Error('Must have Id to update!');
    }
    if (opts.refresh === true) {
      return this.updateComposite(opts.sendAllFields);
    } else {
      const headerOutput = this.setHeader(opts.headers);
      const response = await this._client.request.patch(
        `${this.attributes.url}/${this.id}`,
        this.toJson({ dmlMode: opts.sendAllFields ? 'update' : 'update_modified_only' }),
        { headers: headerOutput }
      );

      // Check if it contains Conditional Request Headers and deal with errors
      const containsGetOrHeadHeader = Object.keys(opts.headers).some((key) => GetOrHeadRequestHeaders.includes(key));
      const containsPatchOrPostHeader = Object.keys(opts.headers).some((key) => PatchOrPostRequestHeaders.includes(key));
      if (containsGetOrHeadHeader && response.status === 304) {
        throw new Error('Not Modified');
      } else if (containsPatchOrPostHeader && response.status === 412) {
        throw new Error('Precondition Failed');
      }

      this._modified.clear();
    }
    return this;
  }

  protected async updateComposite(sendAllFields = false): Promise<this> {
    let batchRequest = new CompositeBatch(this._client).addUpdate(this, { sendAllFields });
    batchRequest.addGet(this, this.handleCompositeBatchGetResult);
    const batchResponse = await batchRequest.send();
    this.handleCompositeBatchErrors(batchResponse);
    this._modified.clear();
    return this;
  }
  /**
   * Deletes the Object from Salesforce
   *
   * @returns {Promise<DMLResponse>}
   * @memberof RestObject
   */
  public async delete(): Promise<DMLResponse> {
    if (this.id == null) {
      throw new Error('Must have Id to Delete!');
    }
    let response = (await this._client.request.delete(`${this.attributes.url}/${this.id}`)).data;
    return response;
  }

  public toJson(opts: {
    dmlMode: 'all' | 'insert' | 'update' | 'update_modified_only';
    hideAttributes?: boolean;
    sendParentObj?: boolean;
    sendChildObj?: boolean;
  }): any {
    const { hideAttributes, sendParentObj, sendChildObj, dmlMode } = opts;

    let data: { [key: string]: any } = {};
    // loop each property
    for (let i in this) {
      // clean properties
      if (!this.hasOwnProperty(i) || this[i] === void 0) {
        continue;
      }

      if (i.toLowerCase() === 'attributes' && !hideAttributes) {
        data[i] = this[i];
      }

      let sFieldProps = getSFieldProps(this, i);
      if (!sFieldProps) {
        continue;
      }

      const fType = !sFieldProps.reference ? 'FIELD' : sFieldProps.childRelationship === true ? 'CHILD' : 'PARENT';
      switch (fType) {
        case 'CHILD':
          if (sendChildObj) {
            data[sFieldProps.apiName] = {
              records: (this[i] as any as RestObject[]).map((obj) => obj.toJson(opts)),
            };
          }
          break;
        case 'PARENT':
          if (sendParentObj) {
            data[sFieldProps.apiName] = this[i] ? (this[i] as any as RestObject).toJson(opts) : null;
          } else {
            // external ID relation support
            if (this[i] && (this as any)[i + 'Id'] === void 0) {
              let relatedSob = this[i] as any as RestObject;
              data[sFieldProps.apiName] = relatedSob.prepareAsRelationRecord();
            }
          }
          break;
        case 'FIELD':
          const canSend =
            dmlMode === 'all' ||
            (dmlMode === 'insert' && sFieldProps.createable) ||
            (dmlMode === 'update' && sFieldProps.updateable) ||
            (dmlMode === 'update_modified_only' && sFieldProps.updateable && this._modified.has(sFieldProps.apiName));

          if (canSend) {
            data[sFieldProps.apiName] = this[i] ? this.toSFValueFormat(sFieldProps, this[i]) : this[i];
          }
          break;
      }
    }
    return data;
  }

  // helper to get values back in salesforce format
  private toSFValueFormat(sFieldProps: SFieldProperties, value: any) {
    if (sFieldProps.salesforceType === SalesforceFieldType.MULTIPICKLIST) {
      return (value as any as string[]).join(';');
    } else if (sFieldProps.salesforceType === SalesforceFieldType.DATE) {
      return calendarToString(value as any as CalendarDate);
    } else {
      return value;
    }
  }

  /**
   * Advanced method used to set a modified API key of a field to send on update
   * @param keys: keys of the object to set the associated field for
   * @memberof RestObject
   */
  public setModified = (keys: Array<keyof this>) => {
    keys.forEach((key) => {
      if (typeof key === 'string') {
        let decorator = getSFieldProps(this, key);
        if (decorator) {
          this._modified.add(decorator.apiName);
        }
      }
    });
  };

  protected prepareAsRelationRecord() {
    let data: { [key: string]: any } = {};
    // otherwise, find first external Id field
    for (let i in this) {
      // clean properties
      if (this.hasOwnProperty(i)) {
        let sFieldProps = getSFieldProps(this, i);
        if (sFieldProps && sFieldProps.externalId && this[i]) {
          data[sFieldProps.apiName] = this[i];
          return data;
        }
      }
    }
    return undefined;
  }

  // copies data from a json object to restobject
  protected mapFromQuery(data: SObject): this {
    // create a map of lowercase API names -> sob property names
    let apiNameMap = this.getNameMapping();

    // loop through returned data
    for (let i in data) {
      if (data.hasOwnProperty(i)) {
        // translate prop name & get decorator
        let sobPropName = apiNameMap.get(i.toLowerCase());
        let sFieldProps = getSFieldProps(this, sobPropName);
        if (!sFieldProps) {
          // no mapping found
          continue;
        }
        if (data[i] === null) {
          if (sFieldProps.childRelationship === true) {
            this[sobPropName] = [];
          } else {
            this[sobPropName] = null;
          }
        } else if (!sFieldProps.reference) {
          let val = data[i];
          if (sFieldProps.salesforceType === SalesforceFieldType.DATETIME) {
            val = new Date(val);
          } else if (sFieldProps.salesforceType === SalesforceFieldType.DATE) {
            val = getCalendarDate(val);
          } else if (sFieldProps.salesforceType === SalesforceFieldType.MULTIPICKLIST) {
            val = val.split(';');
          }
          this[sobPropName] = val;
        } else {
          // reference type
          let type: { new (): RestObject } = sFieldProps.reference();

          if (sFieldProps.childRelationship === true) {
            // child type, map each record
            this[sobPropName] = [];
            if (data[i]) {
              const records = Array.isArray(data[i]) ? data[i] : data[i].records;
              records.forEach((record) => {
                let typeInstance = new type();
                typeInstance._client = this._client;
                this[sobPropName].push(typeInstance.mapFromQuery(record));
              });
            }
          } else {
            let typeInstance = new type();
            typeInstance._client = this._client;
            // parent type.  Map data
            this[sobPropName] = typeInstance.mapFromQuery(data[i]);
          }
        }
      }
    }
    this._modified.clear();
    return this;
  }

  // returns a mapping of API Name (lower case) -> Property Name
  private getNameMapping(): Map<string, string> {
    if (this.__UUID && NAME_MAP_CACHE.has(this.__UUID)) {
      return NAME_MAP_CACHE.get(this.__UUID);
    }

    let apiNameMap = new Map<string, string>();
    for (let i in this) {
      // clean properties
      if (this.hasOwnProperty(i)) {
        let sFieldProps = getSFieldProps(this, i);
        if (sFieldProps) {
          apiNameMap.set(sFieldProps.apiName.toLowerCase(), i);
        } else {
          apiNameMap.set(i, i);
        }
      }
    }
    if (this.__UUID) {
      NAME_MAP_CACHE.set(this.__UUID, apiNameMap);
    }

    return apiNameMap;
  }

  private handleCompositeErrors(compositeResult: CompositeResult) {
    let errors: CompositeBatchResult<any, StandardRestError[]>[] = [];
    compositeResult.compositeResponse.forEach((batchResult) => {
      if (batchResult.httpStatusCode >= 300) {
        let { httpStatusCode: statusCode, body: result } = batchResult;
        errors.push({
          statusCode,
          result,
        });
      }
    });

    if (errors.length) {
      let e = new CompositeError('Failed to execute all Composite Batch Requests');
      e.compositeResponses = errors;
      throw e;
    }
  }

  private handleCompositeBatchErrors(batchResponse: BatchResponse) {
    if (batchResponse.hasErrors) {
      let errors: CompositeBatchResult<any, StandardRestError[]>[] = [];
      batchResponse.results.forEach((batchResult) => {
        if (batchResult.statusCode >= 300) {
          errors.push(batchResult);
        }
      });
      let e = new CompositeError('Failed to execute all Composite Batch Requests');
      e.compositeResponses = errors;
      throw e;
    }
  }

  private setHeader(headersInput: RequestHeadersInput) {
    const headers = {};
    for (const [name, value] of Object.entries(headersInput)) {
      switch (name) {
        case 'Sforce-Auto-Assign':
          headers[name] = value as unknown as boolean;
          break;
        case 'Sforce-Call-Options':
          headers[name] = this.parseSforceCallOptionsHeader(value as SforceCallOptionsHeader);
          break;
        case 'Content-Encoding':
          headers[name] = value;
          break;
        case 'ETag':
          headers[name] = value as string;
          break;
        case 'If-Match':
        case 'If-None-Match':
          headers[name] = `"${(value as string[]).join('", "')}"`;
          break;
        case 'If-Modified-Since':
        case 'If-Unmodified-Since':
          headers[name] = (value as Date).toUTCString();
          break;
        case 'Sforce-Duplicate-Rule-Header':
          headers[name] = this.parseSforceDuplicateRuleHeader(value as SforceDuplicateRuleHeader);
          break;
        case 'Sforce-Mru':
          headers[name] = value as unknown as boolean;
          break;
        case 'Sforce-Query-Options':
          headers[name] = `batchSize=${(value as SforceQueryOptionsHeader).batchSize}`;
          break;
        case 'x-sfdc-packageversion':
          const packageDetail = value as PackageVersionHeader;
          headers[`x-sfdc-packageversion-${packageDetail.package}`] = packageDetail.version;
          break;
      }
    }

    return headers;
  }

  private parseSforceCallOptionsHeader = (value: SforceCallOptionsHeader): string => {
    const options: string[] = [];
    if (value.client) options.push(`client=${value.client}`);
    if (value.defaultNamespace) options.push(`defaultNamespace=${value.defaultNamespace}`);
    return options.join('; ');
  };

  private parseSforceDuplicateRuleHeader = (value: SforceDuplicateRuleHeader): string => {
    const options: string[] = [];
    if (value.allowSave !== undefined) options.push(`allowSave=${value.allowSave}`);
    if (value.includeRecordDetails !== undefined) options.push(`includeRecordDetails=${value.includeRecordDetails}`);
    if (value.runAsCurrentUser !== undefined) options.push(`runAsCurrentUser=${value.runAsCurrentUser}`);
    return options.join(', ');
  };
}
