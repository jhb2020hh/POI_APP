export type FieldType =
  | "text"
  | "multiline"
  | "number"
  | "date"
  | "boolean"
  | "choice"
  // reserviert, kein Renderer im POC:
  | "multi-choice"
  | "person"
  | "image"
  | "file"
  | "signature";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  helpText?: string;
}

export interface CategoryFieldSchema {
  version: 1;
  fields: FieldDef[];
}

export const RENDERABLE_FIELD_TYPES: FieldType[] = [
  "text",
  "multiline",
  "number",
  "date",
  "boolean",
  "choice",
];

export const FIELD_TYPE_LABELS_DE: Record<FieldType, string> = {
  text: "Text",
  multiline: "Mehrzeiliger Text",
  number: "Zahl",
  date: "Datum",
  boolean: "Ja/Nein",
  choice: "Auswahl",
  "multi-choice": "Mehrfachauswahl",
  person: "Person",
  image: "Bild",
  file: "Datei",
  signature: "Unterschrift",
};

export type CustomFieldValues = Record<string, string | number | boolean>;
