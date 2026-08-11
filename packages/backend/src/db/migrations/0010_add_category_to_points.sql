ALTER TABLE points ADD COLUMN category_id TEXT REFERENCES categories(id);
ALTER TABLE points ADD COLUMN custom_fields TEXT;

UPDATE points SET category_id = CASE point_type
  WHEN 'clarification' THEN 'cat-clarification'
  ELSE 'cat-defect'
END;
