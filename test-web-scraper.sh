#!/bin/bash
# Test web scraper integration with a well-known business

echo "Testing Web Scraper with Target Corporation..."
echo ""

curl -X POST http://localhost:5050/find-leads \
  -H "Content-Type: application/json" \
  -d '{
  "accountName": "Target Corporation",
  "postalCode": "55403",
  "addressHint": "1000 Nicollet Mall, Minneapolis, MN"
}' | jq '{
  ok,
  source,
  leadCount: (.leads | length),
  topLeads: (.leads[:3] | map({
    name: .contactName,
    title,
    phone: (.directPhone // .corpPhone),
    email,
    isLocalFacility,
    locationConfidence
  }))
}'

echo ""
echo "Test complete!"
