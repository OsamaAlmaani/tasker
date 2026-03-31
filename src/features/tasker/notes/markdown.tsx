type MarkdownBlock =
	| { type: "heading"; level: 1 | 2 | 3; text: string }
	| { type: "paragraph"; text: string }
	| { type: "blockquote"; text: string }
	| { type: "unordered-list"; items: string[] }
	| { type: "ordered-list"; items: string[] }
	| { type: "task-list"; items: Array<{ checked: boolean; text: string }> }
	| { type: "code"; text: string };

function escapeHtml(text: string) {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function renderInlineMarkdownToHtml(text: string) {
	return escapeHtml(text)
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/\*([^*]+)\*/g, "<em>$1</em>")
		.replace(/`([^`]+)`/g, "<code>$1</code>");
}

function decodeHtmlEntities(text: string) {
	return text
		.replaceAll("&nbsp;", " ")
		.replaceAll("&amp;", "&")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'");
}

export function stripNoteMarkup(body: string) {
	return decodeHtmlEntities(
		body
			.replace(/<[^>]+>/g, " ")
			.replace(/[#>*_`~[\]-]/g, " ")
			.replace(/\s+/g, " ")
			.trim(),
	);
}

export function parseMarkdownBlocks(body: string): MarkdownBlock[] {
	const lines = body.replace(/\r\n/g, "\n").split("\n");
	const blocks: MarkdownBlock[] = [];
	let index = 0;

	while (index < lines.length) {
		const line = lines[index];
		const trimmed = line.trim();

		if (!trimmed) {
			index += 1;
			continue;
		}

		if (trimmed.startsWith("```")) {
			const codeLines: string[] = [];
			index += 1;
			while (index < lines.length && !lines[index].trim().startsWith("```")) {
				codeLines.push(lines[index]);
				index += 1;
			}
			index += 1;
			blocks.push({ type: "code", text: codeLines.join("\n") });
			continue;
		}

		const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
		if (headingMatch) {
			blocks.push({
				type: "heading",
				level: headingMatch[1].length as 1 | 2 | 3,
				text: headingMatch[2],
			});
			index += 1;
			continue;
		}

		if (trimmed.startsWith("> ")) {
			const quoteLines: string[] = [];
			while (index < lines.length && lines[index].trim().startsWith("> ")) {
				quoteLines.push(lines[index].trim().slice(2));
				index += 1;
			}
			blocks.push({ type: "blockquote", text: quoteLines.join(" ") });
			continue;
		}

		if (/^[-*]\s+\[( |x)\]\s+/i.test(trimmed)) {
			const items: Array<{ checked: boolean; text: string }> = [];
			while (
				index < lines.length &&
				/^[-*]\s+\[( |x)\]\s+/i.test(lines[index].trim())
			) {
				const taskMatch = lines[index]
					.trim()
					.match(/^[-*]\s+\[( |x)\]\s+(.+)$/i);
				if (taskMatch) {
					items.push({
						checked: taskMatch[1].toLowerCase() === "x",
						text: taskMatch[2],
					});
				}
				index += 1;
			}
			blocks.push({ type: "task-list", items });
			continue;
		}

		if (/^[-*]\s+/.test(trimmed)) {
			const items: string[] = [];
			while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
				items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
				index += 1;
			}
			blocks.push({ type: "unordered-list", items });
			continue;
		}

		if (/^\d+\.\s+/.test(trimmed)) {
			const items: string[] = [];
			while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
				items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
				index += 1;
			}
			blocks.push({ type: "ordered-list", items });
			continue;
		}

		const paragraphLines: string[] = [];
		while (index < lines.length && lines[index].trim()) {
			const currentTrimmed = lines[index].trim();
			if (
				currentTrimmed.startsWith("```") ||
				/^(#{1,3})\s+/.test(currentTrimmed) ||
				currentTrimmed.startsWith("> ") ||
				/^[-*]\s+\[( |x)\]\s+/i.test(currentTrimmed) ||
				/^[-*]\s+/.test(currentTrimmed) ||
				/^\d+\.\s+/.test(currentTrimmed)
			) {
				break;
			}
			paragraphLines.push(currentTrimmed);
			index += 1;
		}

		if (paragraphLines.length) {
			blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
			continue;
		}

		index += 1;
	}

	return blocks;
}

export function renderMarkdownHtml(body: string) {
	const blocks = parseMarkdownBlocks(body);
	if (!blocks.length) {
		return "<p></p>";
	}

	return blocks
		.map((block) => {
			switch (block.type) {
				case "heading":
					return `<h${block.level}>${renderInlineMarkdownToHtml(block.text)}</h${block.level}>`;
				case "blockquote":
					return `<blockquote><p>${renderInlineMarkdownToHtml(block.text)}</p></blockquote>`;
				case "unordered-list":
					return `<ul>${block.items
						.map((item) => `<li>${renderInlineMarkdownToHtml(item)}</li>`)
						.join("")}</ul>`;
				case "ordered-list":
					return `<ol>${block.items
						.map((item) => `<li>${renderInlineMarkdownToHtml(item)}</li>`)
						.join("")}</ol>`;
				case "task-list":
					return `<ul data-type="taskList">${block.items
						.map(
							(item) =>
								`<li data-type="taskItem" data-checked="${item.checked ? "true" : "false"}"><label><input type="checkbox"${item.checked ? " checked" : ""}><span></span></label><div><p>${renderInlineMarkdownToHtml(item.text)}</p></div></li>`,
						)
						.join("")}</ul>`;
				case "code":
					return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
				default:
					return `<p>${renderInlineMarkdownToHtml(block.text)}</p>`;
			}
		})
		.join("");
}

export function normalizeNoteBody(body: string) {
	const trimmed = body.trim();
	if (!trimmed) {
		return "<p></p>";
	}

	return /<\/?[a-z][\s\S]*>/i.test(trimmed)
		? body
		: renderMarkdownHtml(trimmed);
}
