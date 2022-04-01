import { parse } from "@babel/parser";
import {
  File,
  isArrayExpression,
  isArrowFunctionExpression,
  isBlockStatement,
  isExportDefaultDeclaration,
  isExportNamedDeclaration,
  isFunctionDeclaration,
  isIdentifier,
  isNumericLiteral,
  isObjectExpression,
  isObjectProperty,
  isStringLiteral,
  isVariableDeclaration,
  Node,
  VariableDeclarator,
} from "@babel/types";
import * as vscode from "vscode";
import { window } from "vscode";

/**
 * Prefix used to turn a JSON into a module
 * so that we only need to parse modules
 */
const PREFIX_VARIABLE = "obj";
const MODULE_PREFIX = `let ${PREFIX_VARIABLE} = `;

let path: string;
let documentPath: string;
let moo: string[] = [];

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
 * Extends node to include an index for Arrays
 */
type NodeX = Node & {
  idx?: number;
};

/**
 * Descend the Abstract Syntax Tree
 * and add the object path at each level
 * to the string array (which is returned)
 *
 * @param node Current node
 * @param pos Document offset for hover position
 * @param nodePath Array of nodes to hovered path
 * @returns Array of Nodes for the hovered path
 */
const descendNodes = (node: NodeX, pos: number, nodePath: NodeX[]): NodeX[] => {
  let nextNode: NodeX | undefined;
  let newNodePath: NodeX[] | undefined;

  console.log("descendNodes", node.type);
  ////
  if (isVariableDeclaration(node)) {
    const x: VariableDeclarator[] = node.declarations;
    const vd = x.find(
      (a) =>
        a.start !== null && a.end !== null && a.start <= pos && pos <= a.end
    );
    if (vd?.init && isIdentifier(vd.id)) {
      const identifier = vd.id;
      nextNode = vd.init;
      newNodePath = [...nodePath, identifier];
      return descendNodes(vd.init, pos, [...nodePath, identifier]);
    }
  }

  ////
  if (isObjectExpression(node)) {
    const props = node.properties;
    const child = props.find(
      (n) =>
        n.start !== null && n.end !== null && n.start <= pos && pos <= n.end
    );
    if (isObjectProperty(child)) {
      const attribName = isStringLiteral(child.key) ? child.key.value : "";
      if (!child.value) {
        return [...nodePath, node];
      }
      const { key, value } = child;
      if (key.start && key.end && key.start <= pos && pos <= key.end) {
        return descendNodes(key, pos, [...nodePath, node]);
      }
      return descendNodes(value, pos, [...nodePath, node]);
    }
  }
  ////
  else if (isArrayExpression(node)) {
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
      const nextNode = nodes[idx];
      if (nextNode) {
        return descendNodes(nextNode, pos, [...nodePath, { ...node, idx }]);
      }
    }
  } else if (isExportDefaultDeclaration(node)) {
    //// Ignore exports and drill into them
    return descendNodes(node.declaration, pos, []);
  } else if (isExportNamedDeclaration(node) && node.declaration) {
    //// Ignore exports and drill into them
    return descendNodes(node.declaration, pos, []);
  } else if (isFunctionDeclaration(node)) {
    //// Ignore functions and drill into them
    return descendNodes(node.body, pos, []);
  } else if (isArrowFunctionExpression(node)) {
    //// Ignore arrow functions and drill into them
    return descendNodes(node.body, pos, []);
  } else if (isBlockStatement(node)) {
    const target = node.body.find(
      (n) =>
        n !== null &&
        n.start !== null &&
        n.end !== null &&
        n.start <= pos &&
        pos <= n.end
    );
    if (target !== undefined) {
      return descendNodes(target, pos, []); //[...nodePath, node]);
    }
  } else if (isStringLiteral(node) || isNumericLiteral(node)) {
    // End of the road :)
    return nodePath;
  } else {
    console.info(`Unknown type ${node.type}`);
  }

  // if (nextNode && newNodePath) {
  //   return descendNodes(nextNode, pos, newNodePath);
  // }

  return nodePath;
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
 * For a given document offset, return a prettified string of the JSON path
 */
const prettyPrintPath = (pathArray: NodeX[], pos: number) =>
  pathArray.reduce((acc, node) => {
    const prefx = acc.length > 0 ? acc + "." : "";
    if (isIdentifier(node)) {
      return prefx + node.name;
    }
    if (isArrayExpression(node)) {
      // idx is extra attribute used to track the offset
      return acc + `[${node.idx}]`;
    }
    if (isObjectExpression(node)) {
      const prop = node.properties.find(
        (e) =>
          e !== null &&
          e.start !== null &&
          e.end !== null &&
          e.start <= pos &&
          pos <= e.end
      );
      if (!prop) {
        return acc;
      }
      if (isObjectProperty(prop)) {
        if (isStringLiteral(prop.key)) {
          return prefx + prop.key.value;
        }
        if (isIdentifier(prop.key)) {
          return prefx + `${prop.key.name}`;
        }
      }
      return prefx + `_${prop.type}_`;
    }
    return prefx + `_${node.type}_`;
  }, "");

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
      const pathArray = descendNodes(firstNode, adjPos, []);

      path = prettyPrintPath(pathArray, adjPos);

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
