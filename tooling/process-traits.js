#!/usr/bin/env node
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline/promises";
import { readJson } from "./utils.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const TRAITS_FILE = path.join(repoRoot, "traits", "traits.json");
const METHODS_DIR = path.join(repoRoot, "traits", "methods");
const OUTPUT_DIR = path.join(repoRoot, "traits", "criteria");

let latestCriteriaId = 64

function buildResponse() {
  return {
    type: "multipleChoice",
    possibleResponses: [
      {
        label: "Yes",
        meaning: "The DID method supports this trait.",
      },
      {
        label: "No",
        meaning: "The DID method does not support this trait.",
      },
    ],
  };
}

function traitToCriteria({ key, title, description, questionText, exampleAssessments }) {
  latestCriteriaId++;
  return {
    name: title || key,
    id: `https://www.w3.org/TR/did-rubric#criteria-${latestCriteriaId}`,
    version: "1.0.0",
    source: "https://identity.foundation/did-traits/v1.0.0/",
    question: {
      question: questionText,
      instruction: "",
    },
    response: buildResponse(),
    relevance: description || "",
    assessmentTemplate: {
      columns: [
        {
          heading: "Method",
          type: "method",
          propertyRef: "method"
        },
        {
          heading: "Trait",
          type: "boolean",
          propertyRef: "trait"
        },
        {
          heading: "Notes",
          type: "note",
          propertyRef: "note"
        }
      ],
    },
    exampleAssessments,
  };
}

async function loadMethods() {
  const entries = await fs.readdir(METHODS_DIR, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  const methods = [];

  for (const file of files) {
    const filePath = path.join(METHODS_DIR, file.name);
    const parsed = await readJson(filePath);
    const methodName = parsed.name || path.basename(file.name, ".json");

    if (typeof methodName !== "string" || !methodName.trim()) {
      throw new Error(`Invalid method name in ${filePath}`);
    }

    methods.push({
      name: methodName,
      traits: parsed,
      sourceFile: filePath,
    });
  }

  return methods;
}

function buildExampleAssessments(traitKey, methods) {
  return methods.map((method) => {
    const value = method.traits[traitKey];
    if (typeof value !== "boolean") {
      throw new Error(`Expected boolean for trait "${traitKey}" in ${method.sourceFile}`);
    }

    return {
      id: "",
      method: method.name,
      trait: value ? "Yes" : "No",
      note: "",
      evaluationCitation: "#eval-6",
    };
  });
}

async function main() {
  const traits = await readJson(TRAITS_FILE);
  const methods = await loadMethods();

  if (!traits || typeof traits !== "object" || !traits.properties) {
    throw new Error(`Invalid traits schema: ${TRAITS_FILE}`);
  }

  const traitEntries = Object.entries(traits.properties)
    .filter(([, value]) => value && value.type === "boolean")
    .map(([key, value]) => ({
      key,
      title: value.title || key,
      description: value.description || "",
    }));

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const entries = [];

  try {
    for (const trait of traitEntries) {
      const prompt = `Question for "${trait.title}" w/ description \n ${trait.description} \n : `;
      const questionText = await rl.question(prompt);

      entries.push({
        key: trait.key,
        criteria: traitToCriteria({
          key: trait.key,
          title: trait.title,
          description: trait.description,
          questionText,
          exampleAssessments: buildExampleAssessments(trait.key, methods),
        }),
      });
    }
  } finally {
    rl.close();
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  for (const entry of entries) {
    const criteriaId = entry.criteria.id.split("#criteria-").pop()
    const filename = `${criteriaId}-${entry.criteria.name.toLowerCase().replace(/[,\s]+/g, '-')}.json`;
    const filePath = path.join(OUTPUT_DIR, filename);
    const output = JSON.stringify(entry.criteria, null, 2);
    await fs.writeFile(filePath, output + "\n", "utf8");
  }

  console.log(`Wrote ${entries.length} criteria -> ${path.relative(process.cwd(), OUTPUT_DIR)}`);
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
