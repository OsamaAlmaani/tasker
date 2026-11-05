// Prepares HTML that GitHub rendered (bodyHTML, markdown previews) for display.
// GitHub already sanitizes it; this is a second, allowlist-based pass so Tasker
// never trusts third-party markup on its own origin. It also adapts the markup:
// theme-aware images, in-app links to other pull requests, and copy buttons.

// Elements dropped together with everything inside them.
const DROP_WITH_CONTENT = new Set([
	"script",
	"style",
	"iframe",
	"frame",
	"frameset",
	"object",
	"embed",
	"applet",
	"form",
	"button",
	"textarea",
	"select",
	"option",
	"noscript",
	"template",
	"link",
	"meta",
	"base",
	"title",
	"head",
	"math",
	"portal",
	"dialog",
]);

const ALLOWED_TAGS = new Set([
	"a",
	"abbr",
	"b",
	"bdi",
	"bdo",
	"blockquote",
	"br",
	"caption",
	"cite",
	"code",
	"col",
	"colgroup",
	"dd",
	"del",
	"details",
	"dfn",
	"div",
	"dl",
	"dt",
	"em",
	"figcaption",
	"figure",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"hr",
	"i",
	"img",
	"input",
	"ins",
	"kbd",
	"li",
	"mark",
	"ol",
	"p",
	"picture",
	"pre",
	"q",
	"rp",
	"rt",
	"ruby",
	"s",
	"samp",
	"section",
	"small",
	"source",
	"span",
	"strike",
	"strong",
	"sub",
	"summary",
	"sup",
	"table",
	"tbody",
	"td",
	"tfoot",
	"th",
	"thead",
	"tr",
	"tt",
	"u",
	"ul",
	"var",
	"video",
	"wbr",
	// Octicons inside alerts and task lists.
	"svg",
	"path",
]);

const GLOBAL_ATTRIBUTES = new Set([
	"class",
	"dir",
	"title",
	"align",
	"lang",
	"role",
	"aria-label",
	"aria-hidden",
]);

const TAG_ATTRIBUTES: Record<string, Set<string>> = {
	a: new Set(["href"]),
	img: new Set(["src", "srcset", "alt", "width", "height"]),
	source: new Set(["srcset", "media", "type"]),
	video: new Set(["src", "poster", "width", "height"]),
	input: new Set(["type", "checked"]),
	ol: new Set(["start", "type"]),
	li: new Set(["value"]),
	td: new Set(["colspan", "rowspan"]),
	th: new Set(["colspan", "rowspan", "scope"]),
	col: new Set(["span"]),
	colgroup: new Set(["span"]),
	details: new Set(["open"]),
	div: new Set(["data-snippet-clipboard-copy-content"]),
	time: new Set(["datetime"]),
	svg: new Set(["viewbox", "width", "height", "version", "fill"]),
	path: new Set(["d", "fill-rule", "clip-rule", "fill"]),
};

const URL_ATTRIBUTES = new Set(["href", "src", "poster"]);

export type GitHubHtmlContext = {
	/** `owner/name` of the repository linked to the project. */
	repository: string;
	projectId: string;
};

function safeUrl(value: string, kind: "link" | "media"): string | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (kind === "link" && trimmed.startsWith("#")) return trimmed;
	// GitHub links are absolute; resolve any relative ones against github.com.
	let url: URL;
	try {
		url = new URL(trimmed, "https://github.com");
	} catch {
		return null;
	}
	if (kind === "media") return url.protocol === "https:" ? url.href : null;
	return url.protocol === "https:" ||
		url.protocol === "http:" ||
		url.protocol === "mailto:"
		? url.href
		: null;
}

function safeSrcset(value: string): string | null {
	const candidates = value
		.split(",")
		.map((candidate) => candidate.trim())
		.filter(Boolean)
		.map((candidate) => {
			const [url, ...descriptor] = candidate.split(/\s+/);
			const safe = safeUrl(url, "media");
			return safe ? [safe, ...descriptor].join(" ") : null;
		});
	return candidates.length && candidates.every(Boolean)
		? candidates.join(", ")
		: null;
}

function cleanAttributes(element: Element, tag: string) {
	const allowed = TAG_ATTRIBUTES[tag];
	for (const attribute of [...element.attributes]) {
		const name = attribute.name.toLowerCase();
		// GitHub prefixes user-defined ids (footnotes, headings) so they cannot
		// collide with the page's own ids.
		if (name === "id" && attribute.value.startsWith("user-content-")) continue;
		if (!GLOBAL_ATTRIBUTES.has(name) && !allowed?.has(name)) {
			element.removeAttribute(attribute.name);
			continue;
		}
		if (URL_ATTRIBUTES.has(name)) {
			const safe = safeUrl(attribute.value, name === "href" ? "link" : "media");
			if (safe) element.setAttribute(name, safe);
			else element.removeAttribute(attribute.name);
		} else if (name === "srcset") {
			const safe = safeSrcset(attribute.value);
			if (safe) element.setAttribute(name, safe);
			else element.removeAttribute(attribute.name);
		}
	}
	if (tag === "input") {
		if (element.getAttribute("type") !== "checkbox") {
			element.remove();
			return;
		}
		element.setAttribute("disabled", "");
	}
	if (tag === "video") {
		element.setAttribute("controls", "");
		element.setAttribute("preload", "metadata");
	}
}

function sanitizeNode(node: Node) {
	for (const child of [...node.childNodes]) {
		if (child.nodeType === Node.TEXT_NODE) continue;
		if (child.nodeType !== Node.ELEMENT_NODE) {
			// Comments (GitHub bots leave many), processing instructions, etc.
			child.remove();
			continue;
		}
		const element = child as Element;
		const tag = element.localName.toLowerCase();
		if (DROP_WITH_CONTENT.has(tag)) {
			element.remove();
			continue;
		}
		sanitizeNode(element);
		if (!ALLOWED_TAGS.has(tag)) {
			// Unknown wrappers such as <themed-picture> keep their content.
			element.replaceWith(...element.childNodes);
			continue;
		}
		cleanAttributes(element, tag);
	}
}

/** Replaces <picture> with light/dark images that follow Tasker's theme. */
function adaptPictures(root: ParentNode) {
	for (const picture of [...root.querySelectorAll("picture")]) {
		const fallback = picture.querySelector("img");
		const sourceFor = (scheme: "dark" | "light") =>
			[...picture.querySelectorAll("source")]
				.find((source) =>
					(source.getAttribute("media") ?? "").includes(
						`prefers-color-scheme: ${scheme}`,
					),
				)
				?.getAttribute("srcset")
				?.split(/\s+/)[0];
		const dark = sourceFor("dark");
		const light = sourceFor("light");
		if (!fallback) {
			picture.remove();
			continue;
		}
		if (!dark && !light) {
			picture.replaceWith(fallback);
			continue;
		}
		const themed = (src: string | undefined, theme: "dark" | "light") => {
			const image = fallback.cloneNode() as HTMLImageElement;
			if (src) image.setAttribute("src", src);
			image.removeAttribute("srcset");
			image.classList.add(`gh-only-${theme}`);
			return image;
		};
		picture.replaceWith(themed(light, "light"), themed(dark, "dark"));
	}
}

function adaptImages(root: ParentNode) {
	for (const image of root.querySelectorAll("img")) {
		image.setAttribute("loading", "lazy");
		image.setAttribute("decoding", "async");
		image.setAttribute("referrerpolicy", "no-referrer");
	}
}

function adaptLinks(root: ParentNode, context: GitHubHtmlContext) {
	const [owner, name] = context.repository.split("/");
	const pullLink = new RegExp(
		`^https://github\\.com/${escapeRegExp(owner ?? "")}/${escapeRegExp(name ?? "")}/pull/(\\d+)/?$`,
		"i",
	);
	for (const link of root.querySelectorAll("a[href]")) {
		const href = link.getAttribute("href") ?? "";
		if (href.startsWith("#")) continue;
		const match = href.match(pullLink);
		if (match) {
			link.setAttribute(
				"href",
				`/projects/${encodeURIComponent(context.projectId)}/pulls/${match[1]}`,
			);
			link.setAttribute("data-tasker-link", "");
			continue;
		}
		link.setAttribute("target", "_blank");
		link.setAttribute("rel", "noopener noreferrer nofollow");
	}
}

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Marks code blocks and gives each a copy button. */
function addCopyButtons(root: ParentNode, doc: Document) {
	const blocks = new Set<Element>();
	for (const block of root.querySelectorAll(
		"div[data-snippet-clipboard-copy-content]",
	)) {
		blocks.add(block);
	}
	for (const pre of root.querySelectorAll("pre")) {
		if (!pre.closest("div[data-snippet-clipboard-copy-content]"))
			blocks.add(pre);
	}
	for (const block of blocks) {
		block.classList.add("gh-code-block");
		const button = doc.createElement("button");
		button.setAttribute("type", "button");
		button.setAttribute("class", "gh-copy-button");
		button.setAttribute("data-gh-copy", "");
		button.setAttribute("aria-label", "Copy code");
		button.textContent = "Copy";
		block.append(button);
	}
}

/**
 * Returns safe HTML for GitHub-rendered markup. Returns an empty string where
 * there is no DOM (server rendering); pull request data only loads in the browser.
 */
export function prepareGitHubHtml(
	html: string,
	context: GitHubHtmlContext,
): string {
	if (typeof document === "undefined" || !html.trim()) return "";
	const template = document.createElement("template");
	// Template content is inert: nothing runs or loads while it is cleaned.
	template.innerHTML = html;
	const root = template.content;
	sanitizeNode(root);
	adaptPictures(root);
	adaptImages(root);
	adaptLinks(root, context);
	addCopyButtons(root, document);
	return template.innerHTML;
}

/** Plain text for short previews, such as a conversation list. */
export function githubHtmlToText(html: string, maxLength = 140): string {
	if (typeof document === "undefined") return "";
	const template = document.createElement("template");
	template.innerHTML = html;
	for (const removable of template.content.querySelectorAll(
		"details, pre, img, picture, table",
	)) {
		removable.remove();
	}
	for (const block of template.content.querySelectorAll(
		"p, li, br, div, h1, h2, h3, h4, h5, h6, blockquote, tr",
	)) {
		block.append(" ");
	}
	const text = (template.content.textContent ?? "").replace(/\s+/g, " ").trim();
	return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
