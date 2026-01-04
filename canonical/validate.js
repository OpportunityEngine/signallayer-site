const fs = require("fs");
const path = require("path");

// IMPORTANT: use Ajv configured for JSON Schema Draft 2020-12
const Ajv2020 = require("ajv/dist/2020");

let _validateFn = null;

function getValidator() {
  if (_validateFn) return _validateFn;

  const schemaPath = path.join(__dirname, "invoice.schema.json");
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

  const ajv = new Ajv2020({
    allErrors: true,
    strict: false
  });

  _validateFn = ajv.compile(schema);
  return _validateFn;
}

function validateCanonicalInvoice(invoice) {
  const validate = getValidator();
  const ok = validate(invoice);
  return { ok: !!ok, errors: validate.errors || [] };
}

module.exports = { validateCanonicalInvoice };
