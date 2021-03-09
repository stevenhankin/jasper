import { writeFileSync } from "fs";
import { before } from "mocha";
import * as vscode from "vscode";
import { handleHover } from "../../extension";
import { Hover } from "vscode";
import { expect } from "chai";

type Sample = {
  [key: string]: { path: string; content: string; isJson: boolean };
};

const SAMPLES: Sample = {
  flatObject: {
    path: __dirname + "/sample1.json",
    content: JSON.stringify({
      sample: "hello",
    }),
    isJson: true,
  },
  threeLevels: {
    path: __dirname + "/sample2.json",
    content: JSON.stringify({
      sample: "hello",
      level2: {
        description: "nested attrib",
        level3: {
          targetAttrib: "hoverOnThis",
        },
      },
    }),
    isJson: true,
  },
  arrayExample: {
    path: __dirname + "/sample3.json",
    content: JSON.stringify({
      sample: "hello",
      level2: {
        anArray: [{ thisCode: 0 }, { thatCode: 1 }, { anotherCode: 2 }],
      },
    }),
    isJson: true,
  },
  functionExample: {
    path: __dirname + "/sample4.json",
    content: "const f = () => { const x = { sample: 1 }}",
    isJson: false,
  },
};

suite("Extension Test Suite", async () => {
  before(() => {
    /**
     * Create files for all the samples
     */
    Object.keys(SAMPLES).forEach((key) => {
      const sample = SAMPLES[key];
      writeFileSync(sample.path, sample.content);
      console.log("Written file");
    });
  });

  vscode.window.showInformationMessage("Start all tests.");

  /**
   * Type guard
   */
  function isHover(
    hoverHandler: vscode.ProviderResult<vscode.Hover>
  ): hoverHandler is Hover {
    return (
      hoverHandler !== null &&
      hoverHandler !== undefined &&
      typeof hoverHandler === "object"
    );
  }

  /**
   * Determine offset in document for a specified text
   * so that the hover can be generated on it
   * @param docText
   * @param textToHover
   * @returns
   */
  const getHoverPosition = (docText: string, textToHover: string): number => {
    const hoverOnPos = docText.indexOf(textToHover);
    if (hoverOnPos === undefined) {
      throw new Error(
        `Cannot hover on text ${textToHover} - incorrect unit test or sample data?`
      );
    }
    return hoverOnPos;
  };

  /**
   * Open a sample file (containing either JSON or Module),
   * hover on a piece of text and verify that the
   * expected path strings are returned
   */
  const testHelper = (
    done: Mocha.Done,
    sampleName: string,
    textToHover: string,
    matches: string[]
  ) => {
    const sample = SAMPLES[sampleName];
    vscode.window
      .showTextDocument(vscode.Uri.file(sample.path))
      .then((onfulfilled) => {
        const docText = onfulfilled.document.getText();
        const hoverOnPos = getHoverPosition(docText, textToHover);
        const hoverResult = handleHover(
          onfulfilled.document,
          new vscode.Position(0, hoverOnPos),
          sample.isJson
        );
        try {
          if (isHover(hoverResult)) {
            vscode.Hover;
            const { contents } = hoverResult;
            expect(contents).to.be.a("array");
            expect(contents).to.have.length(1);
            const path = (contents[0] as vscode.MarkdownString).value;
            matches.forEach((m) => {
              expect(path).contains(m);
            });
          }
          done();
        } catch (e) {
          done(e);
        }
      });
  };

  /**
   * Test on a vanilla JSON object
   */
  test("Test simple json", (done) => {
    testHelper(done, "flatObject", "sample", ["sample"]);
  });

  /**
   * Test on a nested object
   */
  test("Test nested json", (done) => {
    testHelper(done, "threeLevels", "hoverOnThis", [
      "level2",
      "level3",
      "targetAttrib",
    ]);
  });

  /**
   * Test on an array object
   * to hover on the 3rd element
   */
  test("Test array json", (done) => {
    testHelper(done, "arrayExample", "anotherCode", ["level2", "anArray[2]"]);
  });

  /**
   * Test hovering on JSON inside a function
   */
  test("Test javascript function", (done) => {
    testHelper(done, "functionExample", "sample", ["x", "sample"]);
  });
});
