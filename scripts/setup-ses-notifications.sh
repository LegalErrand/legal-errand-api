#!/usr/bin/env bash
#
# Wires SES bounce and complaint notifications into the API's webhook, and
# sets a custom MAIL FROM domain so SPF can align for DMARC.
#
# RUN THIS WITH ADMIN CREDENTIALS. The application's own key (user/johnpaul)
# deliberately has only ses:SendEmail and a few reads — it cannot create
# topics or change identity settings, and it should stay that way.
#
#   AWS_PROFILE=<admin> ./scripts/setup-ses-notifications.sh https://api.legalerrand.com
#
# Idempotent: creating a topic or subscription that already exists is a no-op.
set -euo pipefail

API_BASE="${1:-https://api.legalerrand.com}"
REGION="${AWS_REGION:-ap-southeast-2}"
DOMAIN="${SES_DOMAIN:-legalerrand.com}"
MAIL_FROM="${SES_MAIL_FROM_DOMAIN:-send.${DOMAIN}}"
TOPIC_NAME="${SES_TOPIC_NAME:-ses-notifications}"

if [[ "$API_BASE" != https://* ]]; then
  echo "error: the endpoint must be HTTPS — SNS will not post to plain HTTP." >&2
  exit 1
fi

ENDPOINT="${API_BASE%/}/api/v1/ses/notifications"

echo "region   : $REGION"
echo "domain   : $DOMAIN"
echo "endpoint : $ENDPOINT"
echo

echo "1/4  creating SNS topic '$TOPIC_NAME'…"
TOPIC_ARN=$(aws sns create-topic --name "$TOPIC_NAME" --region "$REGION" --query TopicArn --output text)
echo "     $TOPIC_ARN"

echo "2/4  subscribing the webhook…"
aws sns subscribe \
  --topic-arn "$TOPIC_ARN" \
  --protocol https \
  --notification-endpoint "$ENDPOINT" \
  --region "$REGION" \
  --query SubscriptionArn --output text
echo "     SNS will POST a SubscriptionConfirmation; the webhook confirms it"
echo "     automatically once it has verified the signature."

echo "3/4  pointing bounce and complaint feedback at the topic…"
for kind in Bounce Complaint; do
  aws ses set-identity-notification-topic \
    --identity "$DOMAIN" --notification-type "$kind" \
    --sns-topic "$TOPIC_ARN" --region "$REGION"
  echo "     $kind -> topic"
done

# With a topic handling feedback, SES's own email forwarding is redundant and
# sends bounce mail to the From: address instead of being recorded.
aws ses set-identity-feedback-forwarding-enabled \
  --identity "$DOMAIN" --no-forwarding-enabled --region "$REGION"
echo "     email feedback forwarding disabled"

echo "4/4  setting the custom MAIL FROM domain…"
aws ses set-identity-mail-from-domain \
  --identity "$DOMAIN" \
  --mail-from-domain "$MAIL_FROM" \
  --behavior-on-mx-failure UseDefaultValue \
  --region "$REGION"
echo "     $MAIL_FROM  (stays pending until the DNS below exists)"

cat <<EOF

────────────────────────────────────────────────────────────────────────────
Add to the production environment (Railway):

  SES_SNS_TOPIC_ARN=$TOPIC_ARN

────────────────────────────────────────────────────────────────────────────
DNS at Namecheap. Note these are CORRECTIONS, not additions — most of the
setup already exists and one record is simply pointed at the wrong region.

  1. FIX the MAIL FROM MX. $MAIL_FROM currently points at us-east-1
     while the identities and all sending are in $REGION, which is why SES
     reports "MAIL FROM record is not aligned".

       Type MX   Host ${MAIL_FROM%%.*}   Priority 10
       Value feedback-smtp.${REGION}.amazonses.com
       (replacing feedback-smtp.us-east-1.amazonses.com)

     The matching TXT on ${MAIL_FROM%%.*} is already correct; leave it.

  2. FIX the SPF on $DOMAIN — it does not authorise SES at all today, so
     every message SES sends currently fails SPF:

       Type TXT  Host @
       Value v=spf1 include:amazonses.com include:zohomail.com include:spf.efwd.registrar-servers.com ~all

  3. ADD reporting to DMARC, so failures are visible rather than silent:

       Type TXT  Host _dmarc
       Value v=DMARC1; p=none; rua=mailto:dmarc@$DOMAIN; fo=1;

  4. DELETE the stray record whose host is "_dmarc.$DOMAIN". Namecheap
     appends the zone, so it actually publishes _dmarc.$DOMAIN.$DOMAIN,
     which nothing reads. The real one is host "_dmarc" alone.

Leave p=none until the reports show SES and Zoho both passing, then move to
p=quarantine and later p=reject. Tightening before alignment is clean will
send your own login codes to spam, and every sign-in depends on one arriving.
────────────────────────────────────────────────────────────────────────────
EOF
