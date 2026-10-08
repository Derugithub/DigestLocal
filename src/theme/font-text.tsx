import { Children, type ReactNode } from 'react';
import { Platform, Text, type TextStyle } from 'react-native';

import { fontRuns, isEntirelySystem, needsSystemFont } from '@/theme/font-runs';

export type FontWeight = '400' | '500' | '600' | '700';

export function systemFace(weight: FontWeight): TextStyle {
  if (weight === '700') return { fontFamily: 'sans-serif', fontWeight: '700' };
  if (weight === '600' || weight === '500') return { fontFamily: 'sans-serif-medium' };
  return { fontFamily: 'sans-serif' };
}

export function systemFaceOverride(text: string, weight: FontWeight): TextStyle | null {
  if (Platform.OS === 'android' && isEntirelySystem(text)) return systemFace(weight);
  return null;
}

export function inputFontFamily(value: string, preferred: string): string {
  if (Platform.OS === 'android' && needsSystemFont(value)) return 'sans-serif';
  return preferred;
}

/** Keeps Inter on covered letters and switches unsupported scripts to the platform font. */
export function renderFontRuns(text: string, weight: FontWeight): ReactNode {
  if (Platform.OS !== 'android') return text;
  const runs = fontRuns(text);
  if (runs.length <= 1) return text;
  return runs.map((run, index) =>
    run.system ? (
      <Text key={index} style={systemFace(weight)}>
        {run.text}
      </Text>
    ) : (
      <Text key={index}>{run.text}</Text>
    ),
  );
}

export function renderFontChildren(children: ReactNode, weight: FontWeight): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === 'string' || typeof child === 'number') {
      const text = String(child);
      if (Platform.OS === 'android' && isEntirelySystem(text)) {
        return <Text style={systemFace(weight)}>{text}</Text>;
      }
      return renderFontRuns(text, weight);
    }
    return child;
  });
}
