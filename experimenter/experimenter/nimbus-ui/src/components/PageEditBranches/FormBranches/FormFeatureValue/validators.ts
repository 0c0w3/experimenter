import { SchemaDraft, validate } from "@cfworker/json-schema";
import { CompletionContext } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { Diagnostic } from "@codemirror/lint";
import { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import jsonToAst from "json-to-ast";
import { z } from "zod";

/**
 * A simplified schema that is generated by a feature manifest entry with only a
 * simple list of variables.
 */
export const simpleObjectSchema = z.object({
  type: z.literal("object"),
  properties: z.record(
    z.object({
      type: z.optional(
        z.union([
          z.literal("integer"),
          z.literal("boolean"),
          z.literal("string"),
        ]),
      ),
    }),
  ),
});

/**
 * A parsing error from json-to-ast.
 */
const parseError = z.object({
  column: z.number(),
  line: z.number(),
  rawMessage: z.string(),
});

// The schema linter only needs access to the state property. The returned
// function accepsts this type instead of a full EditorView to enable unit
// testing.
type TestableEditorView = Pick<EditorView, "state">;

export function detectDraft(schema: Record<string, unknown>): SchemaDraft {
  let draft: SchemaDraft = "2019-09";
  const { $schema } = schema;

  switch ($schema) {
    case "http://json-schema.org/draft-04/schema#":
      draft = "4";
      break;

    case "http://json-schema.org/draft-07/schema#":
      draft = "7";
      break;

    case "https://json-schema.org/draft/2019-09/schema":
      draft = "2019-09";
      break;

    case "https://json-schema.org/draft/2020-12/schema":
      draft = "2020-12";
      break;
  }

  return draft;
}

export function schemaLinter(schema: Record<string, unknown>) {
  const draft = detectDraft(schema);

  const EMPTY_STRING_RE = /^\s*$/;

  const SCHEMA_RE = /^Property ".*" does not match schema\.$/;
  const ADDITIONAL_PROPERTIES_RE =
    /^Property "(.*)" does not match additional properties schema.$/;

  // Errors that are ignored because they are always accompanied by a more
  // specific, useful error message.
  const IGNORED_ERRORS = [
    "A subschema had errors.",
    `Instance does not match "then" schema.`,
    `Instance does not match "else" schema.`,
    "Instance does not match every subschema.",
    "Items did not match schema.",
  ];

  // An error message for when additionalProperties is false and either the
  // property does not exist or its value has the wrong type.
  const FALSE_BOOLEAN_SCHEMA = "False boolean schema.";

  const ADDITIONAL_PROPERTIES = "additionalProperties";

  return function (view: TestableEditorView): Diagnostic[] {
    const text = view.state.doc.toString();

    if (EMPTY_STRING_RE.test(text)) {
      return [];
    }

    let rootNode;
    try {
      rootNode = jsonToAst(text);
    } catch (e: unknown) {
      const err = parseError.parse(e);
      const pos = documentPosition(view.state.doc, err.line, err.column - 1);

      return [
        {
          from: pos,
          to: pos,
          message: err.rawMessage,
          severity: "error",
        },
      ];
    }

    // Feature configuration values must be objects.
    if (rootNode.type !== "Object") {
      let type: string = rootNode.type;
      if (rootNode.type === "Literal") {
        if (rootNode.value === null) {
          type = "null";
        } else {
          type = typeof rootNode.value;
        }
      }
      return [
        {
          from: 0,
          to: view.state.doc.length,
          message: `Expected a JSON Object, not ${type}`,
          severity: "error",
        },
      ];
    }

    // We know JSON.parse(text) will succeed because we already parsed text into
    // an ast above.
    const validationResult = validate(
      JSON.parse(text),
      schema,
      draft,
      undefined,
      false,
    );

    const diagnostics: Diagnostic[] = [];

    // Keep track of type errors reported by instanceLocation, because a more
    // specific type error will be followed by less helpful, more generic
    // errors.
    const typeErrors = new Set();

    for (const error of validationResult.errors) {
      let message = error.error;

      if (SCHEMA_RE.exec(message)) {
        // We will get a more specific error later.
        continue;
      }

      const instancePath = error.instanceLocation.split("/").slice(1);
      let instanceLocation = error.instanceLocation;
      let nodeKey: keyof FindNodeResult = "value";

      if (error.keyword === "type" && instancePath.length) {
        typeErrors.add(error.instanceLocation);
      } else if (error.keyword === ADDITIONAL_PROPERTIES) {
        const match = ADDITIONAL_PROPERTIES_RE.exec(message);
        if (match) {
          const propertyName = match[1];

          // This error gets reported on the object, not the property. Suppress
          // this error if we've already reported a type error for the property.
          instanceLocation = `${error.instanceLocation}/${propertyName}`;
          if (typeErrors.has(instanceLocation)) {
            continue;
          }

          typeErrors.add(instanceLocation);
          instancePath.push(propertyName);
          message = `Unexpected property "${propertyName}"`;
          nodeKey = "key";
        }
      } else if (
        IGNORED_ERRORS.includes(message) ||
        (message === FALSE_BOOLEAN_SCHEMA &&
          typeErrors.has(error.instanceLocation))
      ) {
        continue;
      }

      const pos = findNode(rootNode, instancePath)[nodeKey]!.loc!;
      const from = documentPosition(
        view.state.doc,
        pos.start.line,
        pos.start.column - 1,
      );
      const to = documentPosition(
        view.state.doc,
        pos.end.line,
        pos.end.column - 1,
      );

      diagnostics.push(createDiagnostic(from, to, message));
    }

    reportFloatValues(view.state.doc, rootNode, diagnostics);

    return diagnostics;
  };
}

/**
 * Return the position given by a line and column in the given document.
 */
function documentPosition(doc: Text, line: number, column: number): number {
  return doc.line(line).from + column;
}

/**
 * Parse an error into a Diagnostic
 */
function createDiagnostic(
  from: number,
  to: number,
  message: string,
  severity = "error",
): Diagnostic {
  return {
    from: from,
    to: to,
    message: message,
    severity: severity,
  } as Diagnostic;
}

interface FindNodeResult {
  value: jsonToAst.ValueNode;
  key?: jsonToAst.IdentifierNode;
}

/**
 * Find a node in the AST by the given path.
 *
 * @returns The node. If the parent node is an Object, then the property name
 *          will also be returned.
 */
function findNode(node: jsonToAst.ValueNode, path: string[]): FindNodeResult {
  if (path.length === 0) {
    return { value: node };
  } else if (node.type === "Object") {
    const child = node.children.find((child) => child.key.value === path[0])!;

    if (path.length === 1) {
      return {
        value: child.value,
        key: child.key,
      };
    }

    return findNode(child.value, path.slice(1));
  } else if (node.type === "Array") {
    const idx = parseInt(path[0]);
    return findNode(node.children[idx], path.slice(1));
  }

  /* istanbul ignore next */
  throw new Error("unreachable");
}

/**
 * Report an error for each floating point value in the AST.
 */
function reportFloatValues(
  doc: Text,
  node: jsonToAst.ValueNode,
  diagnostics: Diagnostic[],
) {
  switch (node.type) {
    case "Array":
      for (const child of node.children) {
        reportFloatValues(doc, child, diagnostics);
      }
      break;

    case "Object":
      for (const child of node.children) {
        reportFloatValues(doc, child.value, diagnostics);
      }
      break;

    case "Literal":
      if (typeof node.value === "number" && ~~node.value !== node.value) {
        const loc = node.loc!;
        diagnostics.push(
          createDiagnostic(
            documentPosition(doc, loc.start.line, loc.start.column),
            documentPosition(doc, loc.start.line, loc.start.column),
            "Floats are not supported",
          ),
        );
      }
      break;
  }
}

type TestableCompletionContext = Pick<CompletionContext, "state" | "pos">;
/**
 * JSON Schema-based autocompletion provider.
 *
 * The returned provider can only infer the top-level property names of very
 * simple JSON schemas.
 */
export function schemaAutocomplete(schema: Record<string, unknown>) {
  let simpleObject;
  try {
    simpleObject = simpleObjectSchema.parse(schema);
  } catch (ex) {
    return null;
  }

  const variableNames = Object.keys(simpleObject.properties);

  return function (ctx: TestableCompletionContext) {
    const node = syntaxTree(ctx.state).resolveInner(ctx.pos, -1);

    if (
      node.type.name === "PropertyName" &&
      node.parent?.type.name === "Property" &&
      node.parent.parent?.type.name === "Object" &&
      node.parent.parent.parent?.type.name === "JsonText"
    ) {
      // This is a property name in the top-level object, so it should be a
      // variable.
      return {
        // node.from will be the opening `"`, so we want the next character to use
        // for auto-complete suggestions.
        from: node.from + 1,
        options: variableNames.map((v) => ({
          label: v,
        })),
      };
    }

    return null;
  };
}

/**
 * Parse from FML errors to Diagnostics
 */
function parseFmlErrors(view: TestableEditorView): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const doc = view.state.doc;
  const text = doc.toString();
  const from = text.indexOf("error");
  if (from === -1) return diagnostics;

  const to = from + "error".length;

  diagnostics.push(createDiagnostic(from, to, "oh no!"));
  return diagnostics;
}

export function fmlLinter() {
  return function (view: TestableEditorView) {
    // TODO call endpoint to retrieve errors, remove temp error highlighting
    return parseFmlErrors(view);
  };
}
