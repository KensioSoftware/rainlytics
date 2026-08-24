// Letting the CloudFront log delivery service use a customer-managed key.
//
// Kept apart from the construct that wires the delivery resources, because
// the reasoning is about IAM rather than about deliveries and because the
// failure it prevents is invisible from every other angle: a bucket
// encrypted with a key the delivery service cannot use accepts the
// configuration, deploys clean, and never receives a log object.

import { ServicePrincipal } from "aws-cdk-lib/aws-iam";
import type { IKey } from "aws-cdk-lib/aws-kms";
import { Annotations, ArnFormat, Resource, Stack } from "aws-cdk-lib/core";
import type { Construct } from "constructs";

/** What the delivery service needs to write an encrypted object. */
const keyActions = [
  "kms:Encrypt",
  "kms:Decrypt",
  "kms:ReEncrypt*",
  "kms:GenerateDataKey*",
  "kms:DescribeKey",
];

/**
 * Grants the delivery service the use of `key`, scoped to this account.
 *
 * Both conditions are deliberate. Without them the key would accept anything
 * the delivery service was asked to write on behalf of any account, which is
 * the confused deputy this pair closes.
 *
 * An imported key belongs to another template, so CDK writes a policy
 * statement nobody will apply and the grant quietly does nothing. That case
 * warns instead, because the alternative is a deploy that succeeds while the
 * logs never arrive.
 */
export function grantLogDeliveryKeyUse(
  scope: Construct,
  key: IKey,
  deliveryRegion: string,
): void {
  if (!Resource.isOwnedResource(key)) {
    Annotations.of(scope).addWarningV2(
      "@kensio/rainlytics:importedEncryptionKey",
      `The log bucket is encrypted with an imported KMS key, so Rainlytics` +
        ` cannot grant delivery.logs.amazonaws.com the use of it. Add that` +
        ` grant to the key policy yourself, or delivery will fail silently.` +
        ` See docs/log-delivery.`,
    );
    return;
  }

  key.grant(deliveryService(scope, deliveryRegion), ...keyActions);
}

function deliveryService(
  scope: Construct,
  deliveryRegion: string,
): ServicePrincipal {
  const stack = Stack.of(scope);

  return new ServicePrincipal("delivery.logs.amazonaws.com", {
    conditions: {
      StringEquals: { "aws:SourceAccount": stack.account },
      // A CloudWatch Logs delivery source ARN separates the resource from
      // its name with a colon. `formatArn` defaults to a slash, and a
      // condition carrying the wrong separator matches nothing, so the grant
      // would be present and do nothing.
      ArnLike: {
        "aws:SourceArn": stack.formatArn({
          service: "logs",
          region: deliveryRegion,
          resource: "delivery-source",
          resourceName: "*",
          arnFormat: ArnFormat.COLON_RESOURCE_NAME,
        }),
      },
    },
  });
}
