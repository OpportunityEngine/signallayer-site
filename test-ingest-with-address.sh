#!/bin/bash
# Test ingest with real business name and address

curl -X POST http://localhost:5050/ingest \
  -H "Content-Type: application/json" \
  -d '{
  "source_type": "chrome",
  "payload": {
    "accountName": "Demo Manufacturing Plant A",
    "items": [
      {
        "sku": "X280",
        "description": "FR JEAN / CARHARTT / RELAXED FIT / DENIM",
        "quantity": "9",
        "unitPrice": "0.67"
      },
      {
        "sku": "64356",
        "description": "FR INSULATED LINER",
        "quantity": "9",
        "unitPrice": "2.50"
      }
    ],
    "billTo": {
      "line1": "Demo Manufacturing Plant A",
      "line2": "1901 Industrial Ave",
      "city_state_zip": "Minneapolis, MN 55430"
    },
    "shipTo": {
      "line1": "Demo Manufacturing Plant A",
      "line2": "1901 Industrial Ave",
      "city_state_zip": "Minneapolis, MN 55430"
    }
  },
  "source_ref": {
    "kind": "url",
    "value": "file:///Users/taylorray/Desktop/real-invoice-demo.html",
    "mime_type": "text/html"
  }
}' | jq '.run_id, .canonical.parties.customer, .status'
