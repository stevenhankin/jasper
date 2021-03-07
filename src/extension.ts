// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import {
  File,
  isArrayExpression,
  isObjectExpression,
  isObjectProperty,
  isStringLiteral,
  Node,
  VariableDeclarator,
} from "@babel/types";
import * as vscode from "vscode";
import { parse } from "@babel/parser";

/**
 * Return the node that contains the hover position
 */
const getContainingNode = (doc: File, pos: number) =>
  doc.program.body.find((n: Node) => {
    const test =
      n.start !== null && n.end !== null && n.start <= pos && pos <= n.end;
    return test;
  });

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
      return descendNodes(vd.init, pos, path, "");
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
      if (isObjectExpression(nextNode)) {
        return descendNodes(nextNode, pos, newPath, "");
      }
    }
  } else {
    console.error(`Unknown type ${node.type}`);
  }
  return path;
};

const MODULE_PREFIX = "let __jasper__ = ";

export const codePrefix = (isJson: boolean): string =>
  isJson ? MODULE_PREFIX : "";

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
  try {
    const pos = document.offsetAt(position);

    const [adjText, adjPos] = getAdjustedDoc(document, isJson, pos);

    const doc = parse(adjText, {
      sourceType: "module",
      plugins: ["jsx"],
    });
    const firstNode = getContainingNode(doc, adjPos);
    if (firstNode) {
      const path = descendNodes(firstNode, adjPos, [], "");
      if (path.length > 0) {
        const contents = [
          new vscode.MarkdownString(`**Path**: ${path.join(".")}`),
        ];
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
  }
};

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log("Jasper extension now enabled");

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  let disposable = vscode.commands.registerCommand("jasper.start", () => {
    // The code you place here will be executed every time your command is executed

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

    // Display a message box to the user
    vscode.window.showInformationMessage("Jasper enabled");
  });

  context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {}
