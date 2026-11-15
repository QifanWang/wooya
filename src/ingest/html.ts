const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
};

function decodeEntities(text: string): string {
  let out = text;
  for (const [entity, char] of Object.entries(ENTITIES)) {
    out = out.split(entity).join(char);
  }
  return out.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

export function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  return decodeEntities(m[1].trim()).slice(0, 120) || null;
}

export function htmlToMarkdown(html: string): string {
  return (
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<h([1-6])[^>]*>/gi, (_, lvl: string) => `\n\n${'#'.repeat(Number(lvl))} `)
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<(p|div|section|article|li|tr|blockquote|pre)[^>]*>/gi, '\n')
      .replace(/<\/(p|div|section|article|li|tr|blockquote|pre)>/gi, '\n')
      .replace(/<(br|hr)[^>]*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .trim()
      .split('\n')
      .map(line => decodeEntities(line).replace(/[ \t]+$/g, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
  );
}
