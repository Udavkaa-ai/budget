import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';

// Виджет на домашний экран: тап открывает приложение сразу на форме добавления
// расхода (deep link familybudget://add). RemoteViews — только простые
// компоненты (Flex/Text), без произвольного JS.
export function AddExpenseWidget() {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: 'familybudget://add' }}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundGradient: { from: '#5947E0', to: '#8A6BFF', orientation: 'TL_BR' },
        borderRadius: 28,
        padding: 10,
      }}
    >
      <TextWidget text="＋" style={{ fontSize: 34, fontWeight: '800', color: '#FFFFFF' }} />
      <TextWidget
        text="Добавить расход"
        maxLines={1}
        style={{ fontSize: 13, fontWeight: '600', color: '#FFFFFF', marginTop: 2, textAlign: 'center' }}
      />
    </FlexWidget>
  );
}
