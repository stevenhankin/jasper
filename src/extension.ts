import {
  File,
  isArrayExpression,
  isIdentifier,
  isObjectExpression,
  isObjectProperty,
  isStringLiteral,
  Node,
  VariableDeclarator,
} from "@babel/types";
import * as vscode from "vscode";
import { parse } from "@babel/parser";
import { window } from "vscode";

/**
 * Prefix used to turn a JSON into a module
 * so that we only need to parse modules
 */
const PREFIX_VARIABLE = "__jasper__";
const MODULE_PREFIX = `let ${PREFIX_VARIABLE} = `;

let path: string;
let documentPath: string;

/**
 * Module prefix only returned when handling a JSON file
 */
export const codePrefix = (isJson: boolean): string =>
  isJson ? MODULE_PREFIX : "";

/**
 * Return the node that contains the hover position
 */
const getContainingNode = (doc: File, pos: number) =>
  doc.program.body.find(
    (n: Node) =>
      n.start !== null && n.end !== null && n.start <= pos && pos <= n.end
  );

/**
 * Descend the Abstract Syntax Tree
 * and add the object path at each level
 * to the string array (which is returned)
 *
 * @param node
 * @param pos
 * @param path
 * @param parentAttr - Attribute name of parent
 * @returns string array of JSON path to hover text
 */
const descendNodes = (
  node: Node,
  pos: number,
  path: string[],
  parentAttr: string
): string[] => {
  console.log("descendNodes", node.type);
  ////
  if (node.type === "VariableDeclaration") {
    const x: VariableDeclarator[] = node.declarations;
    const vd = x.find(
      (a) =>
        a.start !== null && a.end !== null && a.start <= pos && pos <= a.end
    );
    if (vd?.init) {
      const name = isIdentifier(vd.id) ? vd.id.name : "";
      if (name === PREFIX_VARIABLE) {
        // The top-level will be a placeholder that is discarded
        return descendNodes(vd.init, pos, [], name);
      }
      return descendNodes(vd.init, pos, [name], name);
    }
  }

  ////
  else if (node.type === "ObjectExpression") {
    const props = node.properties;
    const child = props.find(
      (n) =>
        n.start !== null && n.end !== null && n.start <= pos && pos <= n.end
    );
    if (isObjectProperty(child)) {
      const attribName = isStringLiteral(child.key) ? child.key.value : "";
      if (child.key.end && pos <= child.key.end) {
        return [...path, attribName];
      }
      const newPath = isArrayExpression(child.value)
        ? path
        : child.key.type === "Identifier"
        ? [...path, child.key.name]
        : child.key.type === "StringLiteral"
        ? [...path, child.key.value]
        : path;
      return descendNodes(child.value, pos, newPath, attribName);
      // }
    }
  }
  ////
  else if (node.type === "ArrayExpression") {
    const nodes = node.elements;
    const idx = nodes.findIndex(
      (a) =>
        a !== null &&
        a.start !== null &&
        a.end !== null &&
        a.start <= pos &&
        pos <= a.end
    );
    if (idx === -1) {
      console.error("weird...could not find expected node");
    } else {
      const newPath = [...path, `${parentAttr}[${idx}]`];
      const nextNode = nodes[idx];
      if (nextNode) {
        return descendNodes(nextNode, pos, newPath, "");
      }
    }
  }
  //// Ignore exports and drill into them
  else if (node.type === "ExportDefaultDeclaration") {
    return descendNodes(node.declaration, pos, [], "");
  } //// Ignore exports and drill into them
  else if (node.type === "ExportNamedDeclaration" && !!node.declaration) {
    return descendNodes(node.declaration, pos, [], "");
  } //// Ignore functions and drill into them
  else if (node.type === "FunctionDeclaration") {
    return descendNodes(node.body, pos, [], "");
  } //// Ignore arrow functions and drill into them
  else if (node.type === "ArrowFunctionExpression") {
    return descendNodes(node.body, pos, [], "");
  } else if (node.type === "BlockStatement") {
    const target = node.body.find(
      (n) =>
        n !== null &&
        n.start !== null &&
        n.end !== null &&
        n.start <= pos &&
        pos <= n.end
    );
    if (target !== undefined) {
      return descendNodes(target, pos, path, "");
    }
  } else if (node.type === "StringLiteral" || node.type === "NumericLiteral") {
    // End of the road :)
    return path;
  } else {
    console.info(`Unknown type ${node.type}`);
  }
  return path;
};

/**
 * Handle JSON document by assigning the JSON to a variable
 * to make it a Module instead
 */
export const getAdjustedDoc = (
  document: vscode.TextDocument,
  isJson: boolean,
  pos: number
): [string, number] => [
  codePrefix(isJson) + document.getText() + (isJson ? ";" : ""),
  isJson ? pos + MODULE_PREFIX.length : pos,
];

/**
 * On hover, create an Abstract Syntax Tree and
 * traverse the nodes down to the hover position
 * keeping a list of the nodes
 * @param document
 * @param position
 */
export const handleHover = (
  document: vscode.TextDocument,
  position: vscode.Position,
  isJson: boolean
): vscode.ProviderResult<vscode.Hover> => {
  console.log("Jasper running..");
  try {
    const pos = document.offsetAt(position);
    documentPath = document.fileName;

    const [adjText, adjPos] = getAdjustedDoc(document, isJson, pos);

    const doc = parse(adjText, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
    const firstNode = getContainingNode(doc, adjPos);
    if (firstNode) {
      const pathArray = descendNodes(firstNode, adjPos, [], "");
      path = pathArray.join(".");
      if (path.length > 0) {
        const contents = [
          new vscode.MarkdownString(
            `**Path**: ${path}\n\n[Copy To Clipboard](command:jasper.copyPathToClipboard)`
          ),
        ];
        contents[0].isTrusted = true;
        return {
          contents,
        };
      }
      return undefined;
    } else {
      const contents = [new vscode.MarkdownString(`**Path**: none`)];
      return { contents };
    }
  } catch (e) {
    console.error("Failed", e);
    return undefined;
  }
};

/**
 * Setup a command to copy the path to the JSON to the clipboard
 *
 * @param context
 */
const copyToPath = (context: vscode.ExtensionContext) => {
  const command = "jasper.copyPathToClipboard";

  const commandHandler = (name: string = "world") => {
    // console.log(`Hello ${name}!!!`);
    vscode.env.clipboard.writeText(`${documentPath}:${path}`).then(() => {
      window.showInformationMessage("Copied to clipboard");
    });
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(command, commandHandler)
  );
};

// method is called when extension is activated
// extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // This line of code will only be executed once when extension is activated
  console.log("Activating Jasper extension");

  copyToPath(context);

  vscode.languages.registerHoverProvider(["javascript", "typescript"], {
    provideHover(document, position, token) {
      return handleHover(document, position, false);
    },
  });

  vscode.languages.registerHoverProvider("json", {
    provideHover(document, position, token) {
      return handleHover(document, position, true);
    },
  });
}

// called when extension is deactivated
export function deactivate() {}
