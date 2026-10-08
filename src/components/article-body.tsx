import { useMemo, type ReactNode } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';

import { blocksFromHtml, inlinesToText, type BlockNode, type InlineNode } from '@/lib/article-html';
import { renderFontRuns, systemFaceOverride, type FontWeight } from '@/theme/font-text';
import { useAppTheme } from '@/theme/preferences';
import { Fonts, type Palette } from '@/theme/palette';

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

export function ArticleBody({
  html,
  plain,
  baseUrl,
}: {
  html: string | null;
  plain: string;
  baseUrl: string;
}) {
  const blocks = useMemo(() => (html?.trim() ? blocksFromHtml(html, baseUrl) : []), [baseUrl, html]);
  if (blocks.length === 0) return <PlainParagraphs text={plain} />;

  const leadIndex = blocks.findIndex((block) => block.type === 'paragraph');
  return (
    <View style={styles.stack}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} lead={index === leadIndex} tone="body" />
      ))}
    </View>
  );
}

function PlainParagraphs({ text }: { text: string }) {
  const { colors } = useAppTheme();
  const paragraphs = text
    .split(/\n\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return null;
  return (
    <View style={styles.stack}>
      {paragraphs.map((paragraph, index) => (
        <Text
          key={`${index}-${paragraph.slice(0, 24)}`}
          selectable
          style={[styles.paragraph, { color: colors.ink }, index === 0 && styles.lead, systemFaceOverride(paragraph, '400')]}>
          {renderFontRuns(paragraph, '400')}
        </Text>
      ))}
    </View>
  );
}

function BlockView({
  block,
  lead,
  tone,
}: {
  block: BlockNode;
  lead: boolean;
  tone: 'body' | 'quote';
}) {
  const { colors } = useAppTheme();

  if (block.type === 'heading') {
    const fontFamily = block.level <= 2 ? Fonts.display : Fonts.bodySemi;
    const weight: FontWeight = block.level <= 2 ? '700' : '600';
    return (
      <Text
        accessibilityRole="header"
        selectable
        style={[
          headingStyle[block.level],
          { color: colors.ink },
          systemFaceOverride(inlinesToText(block.inlines), weight),
        ]}>
        {renderInlines(block.inlines, colors, colors.ink, fontFamily, weight)}
      </Text>
    );
  }

  if (block.type === 'paragraph') {
    const fontFamily = tone === 'quote' ? Fonts.bodyItalic : Fonts.body;
    return (
      <Text
        selectable
        style={[
          styles.paragraph,
          lead && styles.lead,
          tone === 'quote' && styles.quoteText,
          { color: colors.ink },
          systemFaceOverride(inlinesToText(block.inlines), '400'),
        ]}>
        {renderInlines(block.inlines, colors, colors.ink, fontFamily, '400')}
      </Text>
    );
  }

  if (block.type === 'list') {
    return (
      <View style={styles.list}>
        {block.items.map((item, index) => (
          <View key={index} style={styles.listItem}>
            <Text style={[styles.marker, { color: colors.accent }]}>
              {block.ordered ? `${block.start + index}.` : '•'}
            </Text>
            <View style={styles.listBody}>
              {item.blocks.map((child, childIndex) => (
                <BlockView key={childIndex} block={child} lead={false} tone={tone} />
              ))}
            </View>
          </View>
        ))}
      </View>
    );
  }

  if (block.type === 'quote') {
    return (
      <View style={[styles.quote, { borderLeftColor: colors.accent }]}>
        {block.blocks.map((child, index) => (
          <BlockView key={index} block={child} lead={false} tone="quote" />
        ))}
      </View>
    );
  }

  if (block.type === 'pre') {
    return (
      <View style={[styles.pre, { backgroundColor: colors.chip }]}>
        <Text selectable style={[styles.preText, { color: colors.ink }, systemFaceOverride(block.text, '400')]}>
          {renderFontRuns(block.text, '400')}
        </Text>
      </View>
    );
  }

  return <View style={[styles.rule, { backgroundColor: colors.line }]} />;
}

function renderInlines(
  nodes: InlineNode[],
  colors: Palette,
  color: string,
  fontFamily: string,
  weight: FontWeight,
): ReactNode[] {
  return nodes.map((node, index) => {
    if (node.type === 'text') {
      return (
        <Text key={index} style={[{ color, fontFamily }, systemFaceOverride(node.text, weight)]}>
          {renderFontRuns(node.text, weight)}
        </Text>
      );
    }
    if (node.type === 'break') {
      return (
        <Text key={index} style={{ color, fontFamily }}>
          {'\n'}
        </Text>
      );
    }
    if (node.type === 'code') {
      return (
        <Text
          key={index}
          style={[styles.inlineCode, { backgroundColor: colors.chip, color: colors.ink }, systemFaceOverride(node.text, '400')]}>
          {renderFontRuns(node.text, '400')}
        </Text>
      );
    }
    if (node.type === 'strong') {
      return (
        <Text key={index} style={[{ color, fontFamily: Fonts.bodySemi }, systemFaceOverride(inlinesToText(node.children), '600')]}>
          {renderInlines(node.children, colors, color, Fonts.bodySemi, '600')}
        </Text>
      );
    }
    if (node.type === 'em') {
      return (
        <Text key={index} style={[{ color, fontFamily: Fonts.bodyItalic }, systemFaceOverride(inlinesToText(node.children), '400')]}>
          {renderInlines(node.children, colors, color, Fonts.bodyItalic, '400')}
        </Text>
      );
    }
    return (
      <Text
        key={index}
        accessibilityRole="link"
        onPress={() => openLink(node.href)}
        style={[
          { color: colors.accent, fontFamily, textDecorationLine: 'underline' },
          systemFaceOverride(inlinesToText(node.children), weight),
        ]}>
        {renderInlines(node.children, colors, colors.accent, fontFamily, weight)}
      </Text>
    );
  });
}

function openLink(href: string) {
  if (!/^https?:\/\//i.test(href)) return;
  Linking.openURL(href).catch(() => undefined);
}

const headingStyle = StyleSheet.create({
  1: { fontFamily: Fonts.display, fontSize: 28, lineHeight: 34, letterSpacing: -0.3 },
  2: { fontFamily: Fonts.display, fontSize: 24, lineHeight: 30, letterSpacing: -0.2 },
  3: { fontFamily: Fonts.bodySemi, fontSize: 20, lineHeight: 28 },
  4: { fontFamily: Fonts.bodySemi, fontSize: 18, lineHeight: 26 },
  5: { fontFamily: Fonts.bodySemi, fontSize: 17, lineHeight: 24 },
  6: { fontFamily: Fonts.bodySemi, fontSize: 16, lineHeight: 24 },
});

const styles = StyleSheet.create({
  stack: { gap: 16 },
  paragraph: { fontFamily: Fonts.body, fontSize: 17, lineHeight: 26 },
  lead: { fontSize: 18, lineHeight: 28 },
  quoteText: { fontFamily: Fonts.bodyItalic },
  quote: { borderLeftWidth: 3, paddingLeft: 14, gap: 12 },
  list: { gap: 10 },
  listItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  marker: { fontFamily: Fonts.uiMedium, fontSize: 16, lineHeight: 26, minWidth: 22 },
  listBody: { flex: 1, gap: 8 },
  pre: { borderRadius: 16, padding: 14 },
  preText: { fontFamily: mono, fontSize: 14, lineHeight: 22 },
  inlineCode: { fontFamily: mono, fontSize: 16 },
  rule: { height: 1, marginVertical: 2 },
});
