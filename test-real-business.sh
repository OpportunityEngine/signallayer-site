#!/bin/bash
# Test with a real business that OSM should know about

curl -X POST http://localhost:5050/ingest \
  -H "Content-Type: application/json" \
  -d '{
  "source_type": "chrome",
  "payload": {
    "accountName": "Target",
    "items": [
      {
        "sku": "X280",
        "description": "FR JEAN",
        "quantity": "5",
        "unitPrice": "0.67"
      }
    ],
    "shipTo": {
      "line1": "Target Corporation",
      "line2": "1000 Nicollet Mall",
      "city_state_zip": "Minneapolis, MN 55403"
    }
  },
  "source_ref": {
    "kind": "test",
    "value": "manual-test",
    "mime_type": "application/json"
  }
}' | jq -r '.run_id' | {
  read RUN_ID
  echo "Run ID: $RUN_ID"
  echo ""
  echo "Checking leads in 3 seconds..."
  sleep 3
  echo ""
  curl -s "http://localhost:5050/api/runs/$RUN_ID/leads" | jq '{accountName, postalCode, ok, source, leadCount: (.leads | length), leads: (.leads[:2] | map({contactName, corpPhone, score}))}'
}
