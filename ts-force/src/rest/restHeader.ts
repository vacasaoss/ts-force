export type SforceMru = {
  updateMru: boolean;
};
export type PackageVersion = {
  package: string;
  version: string;
};

export type RequestHeadersInput = {
  'Sforce-Auto-Assign'?: boolean;
  'Sforce-Mru'?: SforceMru;
  'x-sfdc-packageversion'?: PackageVersion;
  'If-Modified-Since'?: Date;
  'If-Unmodified-Since'?: Date;
  'If-Match'?: string[];
  'If-None-Match'?: string[];
};

export const GetOrHeadRequestHeaders: (keyof RequestHeadersInput)[] = ['If-Match', 'If-None-Match', 'If-Modified-Since'];
export const PatchOrPostRequestHeaders: (keyof RequestHeadersInput)[] = ['If-Match', 'If-None-Match', 'If-Unmodified-Since'];
