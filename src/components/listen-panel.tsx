import * as Speech from 'expo-speech';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Button, Segmented } from '@/components/ui';
import { chunkForSpeech } from '@/lib/text';
import { useAppTheme } from '@/theme/preferences';
import { Fonts } from '@/theme/palette';

const RATES = [
  { value: '0.9', label: '0.9×' },
  { value: '1', label: '1×' },
  { value: '1.15', label: '1.15×' },
  { value: '1.3', label: '1.3×' },
] as const;

export function ListenPanel({ content }: { content: string }) {
  const { colors } = useAppTheme();
  const chunks = chunkForSpeech(content);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<'idle' | 'playing' | 'paused'>('idle');
  const [rate, setRate] = useState<(typeof RATES)[number]['value']>('1');
  const [error, setError] = useState<string | null>(null);
  const token = useRef(0);
  const indexRef = useRef(0);
  const rateRef = useRef<(typeof RATES)[number]['value']>('1');
  const statusRef = useRef<'idle' | 'playing' | 'paused'>('idle');

  useEffect(() => {
    return () => {
      token.current += 1;
      void Speech.stop();
    };
  }, []);

  const speakFrom = (start: number) => {
    const text = chunks[start];
    if (!text) {
      statusRef.current = 'idle';
      indexRef.current = 0;
      setStatus('idle');
      setIndex(0);
      return;
    }
    const generation = token.current + 1;
    token.current = generation;
    indexRef.current = start;
    statusRef.current = 'playing';
    setIndex(start);
    setStatus('playing');
    setError(null);
    Speech.speak(text, {
      rate: Number(rateRef.current),
      onDone: () => {
        if (token.current !== generation) return;
        const next = start + 1;
        if (next < chunks.length) {
          speakFrom(next);
        } else {
          statusRef.current = 'idle';
          indexRef.current = 0;
          setStatus('idle');
          setIndex(0);
        }
      },
      onError: () => {
        if (token.current !== generation) return;
        statusRef.current = 'idle';
        setStatus('idle');
        setError('This device did not start speech. Check the volume, then try again.');
      },
    });
  };

  const pause = () => {
    token.current += 1;
    void Speech.stop();
    statusRef.current = 'paused';
    setStatus('paused');
  };

  const play = () => {
    const start = status === 'paused' ? indexRef.current : index;
    speakFrom(start);
  };

  const jump = (next: number) => {
    const clamped = Math.max(0, Math.min(chunks.length - 1, next));
    if (status === 'playing') {
      token.current += 1;
      void Speech.stop();
      speakFrom(clamped);
      return;
    }
    indexRef.current = clamped;
    statusRef.current = 'paused';
    setIndex(clamped);
    setStatus('paused');
  };

  const current = chunks[index] ?? '';
  const passage = chunks.length === 0 ? 0 : status === 'idle' && index === 0 ? 1 : index + 1;

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <AppText variant="label" color={colors.accent}>
        On this device
      </AppText>
      <AppText variant="title" style={styles.heading}>
        Listen
      </AppText>
      <AppText variant="ui" color={colors.soft}>
        Spoken by the operating system. The article text is not uploaded.
      </AppText>

      <View style={[styles.passage, { backgroundColor: colors.elevated, borderColor: colors.line }]}>
        <AppText variant="label" color={colors.faint}>
          {chunks.length === 0 ? 'Nothing to read' : `Passage ${passage} of ${chunks.length}`}
        </AppText>
        <AppText style={[styles.passageText, { color: colors.ink }]}>{current}</AppText>
      </View>

      {error ? (
        <AppText variant="ui" color={colors.bad}>
          {error}
        </AppText>
      ) : null}

      <Button
        label={status === 'playing' ? 'Pause' : status === 'paused' ? 'Resume' : 'Play'}
        icon={status === 'playing' ? 'pause' : 'play'}
        onPress={status === 'playing' ? pause : play}
        disabled={chunks.length === 0}
      />
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button label="Previous" variant="secondary" onPress={() => jump(index - 1)} disabled={index === 0} />
        </View>
        <View style={styles.flex}>
          <Button
            label="Next"
            variant="secondary"
            onPress={() => jump(index + 1)}
            disabled={index >= chunks.length - 1}
          />
        </View>
      </View>
      <Segmented
        value={rate}
        options={[...RATES]}
        onChange={(next) => {
          setRate(next);
          rateRef.current = next;
          if (statusRef.current === 'playing') {
            token.current += 1;
            void Speech.stop();
            speakFrom(indexRef.current);
          }
        }}
      />
      <AppText variant="meta" color={colors.faint}>
        Pause keeps this passage. Play continues from here. On Android, pause stops the voice and resume repeats the current passage.
      </AppText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 22, paddingTop: 8, paddingBottom: 28, gap: 16 },
  heading: { marginTop: -6 },
  passage: { borderWidth: 1, borderRadius: 22, padding: 18, gap: 12 },
  passageText: { fontFamily: Fonts.body, fontSize: 22, lineHeight: 34 },
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
});
