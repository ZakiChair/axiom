function cleanExtractedText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractPdfStrings(content: string): string {
  const strings: string[] = [];
  let current = "";
  let depth = 0;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index] ?? "";

    if (depth === 0) {
      if (character === "(") {
        depth = 1;
        current = "";
      }
      continue;
    }

    if (character === "\\") {
      const escaped = content[index + 1] ?? "";
      const decoded = escaped === "n" ? "\n" : escaped === "r" ? "\r" : escaped === "t" ? "\t" : escaped;
      current += decoded;
      index += 1;
      continue;
    }

    if (character === "(") {
      depth += 1;
      current += character;
      continue;
    }

    if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        strings.push(current);
      } else {
        current += character;
      }
      continue;
    }

    current += character;
  }

  return cleanExtractedText(strings.join("\n"));
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLocaleLowerCase("fr-CH").endsWith(".pdf");
}

export async function readImportFile(file: File): Promise<string> {
  try {
    if (!isPdf(file)) {
      const text = cleanExtractedText(await file.text());
      if (text.length > 0) {
        return text;
      }
    } else {
      const binary = await file.arrayBuffer();
      const text = extractPdfStrings(new TextDecoder("iso-8859-1").decode(binary));
      if (text.length > 0) {
        return text;
      }
    }
  } catch {
    // La même erreur compréhensible est présentée quel que soit l'échec de lecture.
  }

  throw new Error("Aucun texte n'a pu être lu : veuillez procéder à une saisie manuelle.");
}

export function downloadText(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = name;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
