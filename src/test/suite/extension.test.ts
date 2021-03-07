import * as assert from "assert";
import { readdir, writeFile, close } from "fs";
import { before } from "mocha";
import { PathLike } from "node:fs";
import * as vscode from "vscode";
import { handleHover } from "../../extension";
import { Hover } from "vscode";
import { expect } from "chai";

const SAMPLES = [
  {
    path: __dirname + "/sampleX.json",
    content: JSON.stringify({
      sample: "hello",
    }),
  },
];

suite("Extension Test Suite", async () => {
  before((done) => {
    /**
     * Create JSON sample files
     */
    SAMPLES.forEach((sample) => {
      writeFile(sample.path, sample.content, () => {
        console.log("Written file");
        done();
      });
    });
  });

  vscode.window.showInformationMessage("Start all tests.");

  function isHover(
    hoverHandler: vscode.ProviderResult<vscode.Hover>
  ): hoverHandler is Hover {
    return (
      hoverHandler !== null &&
      hoverHandler !== undefined &&
      typeof hoverHandler === "object"
    );
  }

  test("Test simple json", (done) => {
    vscode.window
      .showTextDocument(vscode.Uri.file(SAMPLES[0].path))
      .then((onfulfilled) => {
        const hoverResult = handleHover(
          onfulfilled.document,
          new vscode.Position(0, 10),
          true
        );
        try {
          if (isHover(hoverResult)) {
            vscode.Hover;
            const { contents } = hoverResult;
            expect(contents).to.be.a("array");
            expect(contents).to.have.length(1);
            expect((contents[0] as vscode.MarkdownString).value).contains(
              "sample"
            );
          }
          done();
        } catch (e) {
          done(e);
        }
      });
  });
});
