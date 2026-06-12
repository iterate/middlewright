import React from "react";
import { colors } from "../theme";

type Token = { text: string; color: string; italic?: boolean };

const pattern = new RegExp(
  [
    String.raw`(\/\/.*$)`, // comment
    String.raw`("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|` + "`(?:\\\\.|[^`\\\\])*`" + `)`, // string
    String.raw`\b(import|from|export|const|let|var|async|await|default|return|new|type|function|extends|as|using|if)\b`, // keyword
    String.raw`\b(\d[\d_]*)\b`, // number
  ].join("|"),
  "gm",
);

export const tokenize = (line: string): Token[] => {
  const tokens: Token[] = [];
  let lastIndex = 0;
  pattern.lastIndex = 0;
  for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
    if (match.index > lastIndex) {
      tokens.push({ text: line.slice(lastIndex, match.index), color: colors.synDefault });
    }
    const [, comment, string, keyword, number] = match;
    if (comment !== undefined) tokens.push({ text: comment, color: colors.synComment, italic: true });
    else if (string !== undefined) tokens.push({ text: string, color: colors.synString });
    else if (keyword !== undefined) tokens.push({ text: keyword, color: colors.synKeyword });
    else if (number !== undefined) tokens.push({ text: number, color: colors.synNumber });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < line.length) {
    tokens.push({ text: line.slice(lastIndex), color: colors.synDefault });
  }
  return tokens;
};

export const HighlightedLine: React.FC<{ text: string }> = ({ text }) => (
  <>
    {tokenize(text).map((token, i) => (
      <span key={i} style={{ color: token.color, fontStyle: token.italic ? "italic" : "normal" }}>
        {token.text}
      </span>
    ))}
  </>
);
