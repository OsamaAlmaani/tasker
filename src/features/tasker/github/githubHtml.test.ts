// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { githubHtmlToText, prepareGitHubHtml } from "./githubHtml";

const context = { repository: "acme/app", projectId: "proj1" };

function render(html: string) {
	const container = document.createElement("div");
	container.innerHTML = prepareGitHubHtml(html, context);
	return container;
}

describe("prepareGitHubHtml", () => {
	it("removes scripts, handlers, styles and unsafe URLs", () => {
		const container = render(
			[
				'<p onclick="alert(1)" style="color:red">Hi <script>alert(1)</script></p>',
				'<img src="x" onerror="alert(1)">',
				'<a href="javascript:alert(1)">bad</a>',
				'<a href="data:text/html,hi">data</a>',
				'<img src="https://example.com/a.png" srcset="javascript:alert(1) 2x">',
				'<iframe src="https://evil.example"></iframe>',
				"<form><input name=q></form>",
				'<svg><a href="javascript:alert(1)"><path d="M0"/></a></svg>',
				"<details><summary>More</summary><style>*{}</style>Body</details>",
			].join(""),
		);
		const html = container.innerHTML;
		expect(html).not.toMatch(
			/script|onclick|onerror|style|javascript:|data:|iframe|form/i,
		);
		expect(container.querySelector("p")?.textContent).toBe("Hi ");
		expect(
			container.querySelector('img[src="https://example.com/a.png"]'),
		).not.toBeNull();
		expect(container.querySelector("img[srcset]")).toBeNull();
		expect(container.querySelector("details summary")?.textContent).toBe(
			"More",
		);
	});

	it("drops HTML comments and unwraps unknown elements", () => {
		const container = render(
			"<!-- bot:marker --><themed-picture><b>kept</b></themed-picture><x-foo>text</x-foo>",
		);
		expect(container.innerHTML).toBe("<b>kept</b>text");
	});

	it("turns color-scheme pictures into theme-aware images", () => {
		const container = render(
			'<picture><source media="(prefers-color-scheme: dark)" srcset="https://img/dark.svg"><source media="(prefers-color-scheme: light)" srcset="https://img/light.svg"><img alt="Logo" src="https://img/fallback.png" width="20"></picture>',
		);
		const images = [...container.querySelectorAll("img")];
		expect(
			images.map((image) => [image.className, image.getAttribute("src")]),
		).toEqual([
			["gh-only-light", "https://img/light.svg"],
			["gh-only-dark", "https://img/dark.svg"],
		]);
		expect(images[0].getAttribute("alt")).toBe("Logo");
		expect(images[0].getAttribute("loading")).toBe("lazy");
		expect(container.querySelector("picture, source")).toBeNull();
	});

	it("keeps links to the linked repository's pull requests inside Tasker", () => {
		const container = render(
			'<a href="https://github.com/ACME/app/pull/42">#42</a><a href="https://github.com/other/app/pull/1">x</a><a href="#user-content-fn-1">1</a>',
		);
		const [internal, external, footnote] = container.querySelectorAll("a");
		expect(internal.getAttribute("href")).toBe("/projects/proj1/pulls/42");
		expect(internal.hasAttribute("data-tasker-link")).toBe(true);
		expect(internal.hasAttribute("target")).toBe(false);
		expect(external.getAttribute("target")).toBe("_blank");
		expect(external.getAttribute("rel")).toBe("noopener noreferrer nofollow");
		expect(footnote.getAttribute("href")).toBe("#user-content-fn-1");
	});

	it("disables task list checkboxes and adds copy buttons to code", () => {
		const container = render(
			'<ul><li><input type="checkbox" checked> done</li></ul><input type="text" value="x"><div class="highlight" data-snippet-clipboard-copy-content="echo hi"><pre>echo hi</pre></div><pre>plain</pre>',
		);
		const checkbox = container.querySelector("input");
		expect(checkbox?.hasAttribute("disabled")).toBe(true);
		expect(container.querySelectorAll("input")).toHaveLength(1);
		expect(container.querySelectorAll("[data-gh-copy]")).toHaveLength(2);
		expect(container.querySelectorAll(".gh-code-block")).toHaveLength(2);
	});

	it("keeps real GitHub markup readable", () => {
		const html = `<p dir="auto">Fixes <a href="https://github.com/acme/app/pull/7" data-hovercard-type="pull_request">#7</a></p><markdown-accessiblity-table><table><thead><tr><th>Check</th></tr></thead><tbody><tr><td>Passed</td></tr></tbody></table></markdown-accessiblity-table><div class="markdown-alert markdown-alert-note" dir="auto"><p class="markdown-alert-title" dir="auto"><svg class="octicon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M0 8a8 8 0 1 1 16 0"></path></svg>Note</p><p dir="auto">Read me</p></div>`;
		const container = render(html);
		expect(container.querySelector("table td")?.textContent).toBe("Passed");
		expect(
			container.querySelector(".markdown-alert-note svg path"),
		).not.toBeNull();
		expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe(
			"0 0 16 16",
		);
		expect(
			container.querySelector("a")?.getAttribute("data-hovercard-type"),
		).toBeNull();
	});
});

describe("githubHtmlToText", () => {
	it("summarizes prose and skips code and collapsed sections", () => {
		expect(
			githubHtmlToText(
				"<p>Use   a helper</p><pre>code</pre><details><summary>x</summary>hidden</details><p>here.</p>",
			),
		).toBe("Use a helper here.");
		expect(githubHtmlToText("<p>abcdefghij</p>", 5)).toBe("abcd…");
	});
});
