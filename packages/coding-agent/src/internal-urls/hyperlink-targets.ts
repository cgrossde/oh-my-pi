import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as url from "node:url";
import { TERMINAL } from "@oh-my-pi/pi-tui";
import { fileUriForTerminal } from "@oh-my-pi/pi-tui/render/hyperlink";
import { extractUriScheme, InternalUrlRouter, parseInternalUrl, type ResolveContext } from "./index";
import { parseSel } from "../tools/read-selector";
import { expandPath } from "../tools/path-utils";

function splitLocalPathSelector(href: string): { filePath: string; suffix: string } {
	const suffixIndex = href.search(/[?#]/);
	const pathPart = suffixIndex < 0 ? href : href.slice(0, suffixIndex);
	const suffix = suffixIndex < 0 ? "" : href.slice(suffixIndex);
	const selectorIndex = pathPart.lastIndexOf(":");
	if (selectorIndex < 0) return { filePath: pathPart, suffix };
	const selector = pathPart.slice(selectorIndex + 1);
	return parseSel(selector).kind === "none"
		? { filePath: pathPart, suffix }
		: { filePath: pathPart.slice(0, selectorIndex), suffix };
}

/**
 * Resolve Markdown link destinations (as extracted by `getMarkdownLinkUrls`)
 * to existing local resources or absolute file URLs. Relative paths use the
 * calling session's cwd; missing, virtual, and remote targets stay unchanged.
 */
export async function resolveMarkdownLinkHrefs(
	hrefs: Iterable<string>,
	context?: ResolveContext,
): Promise<ReadonlyMap<string, string>> {
	const targets = new Map<string, string>();
	const urls = new Set<string>();
	const router = InternalUrlRouter.instance();
	for (const href of hrefs) {
		if (!href || /[\x00-\x1f\x7f]/.test(href) || /^(?:#|\?|\/\/)/.test(href)) continue;
		const scheme = extractUriScheme(href);
		// Rendering must not fetch remote resources or materialize secrets:
		// only linkable schemes locate locally and cheaply.
		if (!scheme || scheme === "file" || (router.spec(scheme)?.linkable && router.canHandle(href))) {
			urls.add(href);
		}
	}
	await Promise.all(
		[...urls].map(async href => {
			try {
				let sourcePath: string;
				let suffix: string;
				if (router.canHandle(href)) {
					const located = await router.locate(href, context);
					if (located === null) return;
					sourcePath = located;
					suffix = parseInternalUrl(href).hash;
				} else {
					const { filePath, suffix: localSuffix } = splitLocalPathSelector(href);
					suffix = localSuffix;
					const decoded =
						extractUriScheme(filePath) === "file" ? url.fileURLToPath(filePath) : decodeURIComponent(filePath);
					sourcePath = path.resolve(context?.cwd ?? process.cwd(), expandPath(decoded));
				}
				const stat = await fs.stat(sourcePath);
				if (!stat.isFile() && !stat.isDirectory()) return;
				targets.set(href, fileUriForTerminal(sourcePath, undefined, TERMINAL.id) + suffix);
			} catch {
				// A model-authored link may be incomplete, stale, or outside the resource root.
			}
		}),
	);
	return targets;
}
