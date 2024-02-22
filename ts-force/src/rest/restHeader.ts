export type SforceMru = {
  updateMru: boolean;
};
export type PackageVersion = {
  package: string;
  version: string;
};

export type GenericHeader = {
  header: string;
  value: string;
};

export type RequestHeadersInput = {
  'Sforce-Auto-Assign'?: boolean;
  'Sforce-Mru'?: SforceMru;
  'x-sfdc-packageversion'?: PackageVersion;
  'If-Modified-Since'?: Date;
  'If-Unmodified-Since'?: Date;
  'If-Match'?: string[];
  'If-None-Match'?: string[];
  'Generic-Header'?: GenericHeader;
};

export const ConditionalRequestHeaders: (keyof RequestHeadersInput)[] = [
  'If-Match',
  'If-None-Match',
  'If-Modified-Since',
  'If-Unmodified-Since',
];
