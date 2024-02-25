export type RequestHeadersInput = {
  'Sforce-Auto-Assign'?: boolean;
  'If-Modified-Since'?: Date;
  'If-Unmodified-Since'?: Date;
};
export type GeneralRequestHeadersInput = RequestHeadersInput | Record<string, string>;

export const ConditionalRequestHeaders = ['If-Match', 'If-None-Match', 'If-Modified-Since', 'If-Unmodified-Since'];
