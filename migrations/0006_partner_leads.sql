-- Which lead investors the partner belongs to, as investor keys (JSON). A round with two leads gives
-- the partner only to the lead its sentence names. NULL: every lead (rows checked before this).
ALTER TABLE companies ADD COLUMN partner_leads_json TEXT;
