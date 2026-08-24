// The one region CloudFront log delivery can be configured from.
//
// Its own module because both halves of the pipeline need it and neither
// should have to import the other to get it. The bucket grants the delivery
// service access scoped to this region's delivery sources, and the delivery
// construct refuses to be deployed anywhere else.

/**
 * Standard logging v2 is configured through the CloudWatch Logs API, and that
 * API only accepts these calls in us-east-1 however far away the bucket is.
 */
export const logDeliveryRegion = "us-east-1";
