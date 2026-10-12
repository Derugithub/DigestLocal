import * as Speech from 'expo-speech';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Button, Segmented } from '@/components/ui';
import { useAds } from '@/lib/ads/ads-context';
import { chunkForSpeech } from '@/lib/text';
import { useAppTheme } from '@/theme/preferences';
import { Fonts } from '@/theme/palette';

const FREE_RATES = [
  { value: '0.9', label: '0.9×' },
  { value: '1', label: '1×' },
  { value: '1.15', label: '1.15×' },
  { value: '1.3', label: '1.3×' },
] as const;

const EXTRA_RATES = [
  { value: '1.5', label: '1.5×' },
  { value: '2', label: '2×' },
] as const;

type RateValue = (typeof FREE_RATES)[number]['value'] | (typeof EXTRA_RATES)[number]['value'];

function isExtraRate(value: RateValue): value is (typeof EXTRA_RATES)[number]['value'] {
  return value === '1.5' || value === '2';
}

export function ListenPanel({ content }: { content: string }) {
  const { colors } = useAppTheme();
  const ads = useAds();
  const { suppress, release } = ads;
  const extraUnlocked = Platform.OS === 'web' || ads.extraSpeedsUnlocked;
  const chunks = chunkForSpeech(content);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<'idle' | 'playing' | 'paused'>('idle');
  const [rate, setRate] = useState<RateValue>('1');
  const [error, setError] = useState<string | null>(null);
  const [speedNote, setSpeedNote] = useState<string | null>(null);
  const token = useRef(0);
  const indexRef = useRef(0);
  const rateRef = useRef<RateValue>('1');
  const statusRef = useRef<'idle' | 'playing' | 'paused'>('idle');
  const held = useRef(false);

  useEffect(() => {
    if (status === 'playing' || status === 'paused') suppress('listen');
    else release('listen');
  }, [release, status, suppress]);

  useEffect(() => {
    return () => release('listen');
  }, [release]);

  useEffect(() => {
    return () => {
      held.current = true;
      token.current += 1;
      void Speech.stop();
    };
  }, []);

  const speakFromRef = useRef<(start: number) => void>(() => undefined);

  const speakFrom = (start: number) => {
    const text = chunks[start];
    if (!text) {
      statusRef.current = 'idle';
      indexRef.current = 0;
      setStatus('idle');
      setIndex(0);
      return;
    }
    held.current = false;
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
        if (held.current || token.current !== generation) return;
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
        // Web speechSynthesis.cancel() reports the stopped utterance as an error.
        // Pause already moved the controls; leave them there.
        if (held.current || token.current !== generation) return;
        statusRef.current = 'idle';
        setStatus('idle');
        setError('This device did not start speech. Check the volume, then try again.');
      },
    });
  };

  useEffect(() => {
    speakFromRef.current = speakFrom;
  });

  const applyRate = (next: RateValue) => {
    setRate(next);
    rateRef.current = next;
    setSpeedNote(null);
    if (statusRef.current === 'playing') {
      token.current += 1;
      void Speech.stop();
      speakFrom(indexRef.current);
    }
  };

  useEffect(() => {
    if (extraUnlocked || !isExtraRate(rateRef.current)) return;
    rateRef.current = '1';
    setRate('1');
    if (statusRef.current !== 'playing') return;
    token.current += 1;
    void Speech.stop();
    speakFromRef.current(indexRef.current);
  }, [extraUnlocked]);

  const chooseRate = (next: RateValue) => {
    if (!isExtraRate(next) || extraUnlocked) {
      applyRate(next);
      return;
    }
    if (!ads.canOfferRewarded('extra_speeds') || !ads.rewardedLoaded) {
      setSpeedNote(ads.canOfferRewarded('extra_speeds') ? 'Ad not ready' : 'Not available right now');
      ads.preloadRewarded();
      return;
    }
    if (statusRef.current === 'playing') {
      held.current = true;
      token.current += 1;
      statusRef.current = 'paused';
      setStatus('paused');
      void Speech.stop();
    }
    release('listen');
    void ads.showRewarded('extra_speeds').then((result) => {
      if (result === 'earned') applyRate(next);
    });
  };

  const pause = () => {
    held.current = true;
    token.current += 1;
    statusRef.current = 'paused';
    setStatus('paused');
    void Speech.stop();
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

  const untilLabel =
    ads.extraSpeedsUntil == null
      ? null
      : new Date(ads.extraSpeedsUntil).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
  const speedCaption =
    speedNote ??
    (extraUnlocked && !ads.isPro && untilLabel
      ? `1.5× and 2× until ${untilLabel}.`
      : extraUnlocked
        ? null
        : '0.9× to 1.3× stay free. Watch an ad to unlock 1.5× and 2× for 24 hours.');

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
      <View style={styles.speeds}>
        <AppText variant="label" color={colors.faint}>
          Speed
        </AppText>
        <Segmented value={rate} options={[...FREE_RATES]} onChange={chooseRate} />
        <AppText variant="label" color={colors.faint}>
          Faster
        </AppText>
        <Segmented value={rate} options={[...EXTRA_RATES]} onChange={chooseRate} />
        {speedCaption ? (
          <AppText variant="meta" color={colors.faint}>
            {speedCaption}
          </AppText>
        ) : null}
      </View>
      <AppText variant="meta" color={colors.faint}>
        Pause keeps this passage. Play continues from here. On Android, pause stops the voice and resume repeats the current passage.
      </AppText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 22, paddingTop: 8, paddingBottom: 28, gap: 16 },
  heading: { marginTop: -6 },
  speeds: { gap: 8 },
  passage: { borderWidth: 1, borderRadius: 22, padding: 18, gap: 12 },
  passageText: { fontFamily: Fonts.body, fontSize: 20, lineHeight: 30 },
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
});
