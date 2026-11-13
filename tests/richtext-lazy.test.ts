import { describe, expect, it } from "vitest";
import { renderWith, needsLibraries } from "@/lib/richtext-core";
import { renderRichText } from "@/lib/richtext";

/**
 * Notices and lessons show at once with the light formatter; KaTeX and highlight.js load only
 * for text with maths or code. Text without them must look exactly the same either way.
 */
describe("rich text without the maths and code libraries", () => {
  const plain = [
    "# Welcome back\n\nSchool resumes on **Monday** at 7:45.",
    "- Bring your _textbooks_\n- Fees: $5 and $10 at the bursary",
    "1. Register\n2. Assembly\n\nSee [the calendar](https://example.com/cal).",
    "Use `print()` to show a value. <script>alert(1)</script>"
  ];
  it("is identical to the full formatter when there is no maths or code block", () => {
    for (const t of plain) expect(renderWith(t)).toBe(renderRichText(t));
  });
  it("knows when the libraries are needed", () => {
    expect(needsLibraries("Solve $x^2 = 4$")).toBe(true);
    expect(needsLibraries("\\(a+b\\)")).toBe(true);
    expect(needsLibraries("```python\nprint(1)\n```")).toBe(true);
    expect(needsLibraries("No maths here.")).toBe(false);
    expect(needsLibraries(null)).toBe(false);
  });
  it("shows maths and code as safe plain text until the libraries arrive", () => {
    const html = renderWith("Area: $\\pi r^2$\n\n```js\nlet a = '<b>';\n```");
    expect(html).toContain("<code>\\pi r^2</code>");
    expect(html).toContain("let a = &#39;&lt;b&gt;&#39;;");
    expect(html).not.toContain("<b>");
  });
  it("renders maths with KaTeX in the full formatter", () => {
    expect(renderRichText("Area: $\\pi r^2$")).toContain("katex");
  });
});
