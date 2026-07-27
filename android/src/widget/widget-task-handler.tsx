import React from 'react';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { AddExpenseWidget } from './AddExpenseWidget';

const nameToWidget = {
  AddExpense: AddExpenseWidget,
};

// Обработчик задач виджета (headless JS). Рисуем виджет при добавлении/обновлении.
// Клик (OPEN_URI) обрабатывается нативно — открывает приложение по deep link.
export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const Widget = nameToWidget[props.widgetInfo.widgetName as keyof typeof nameToWidget];
  if (!Widget) return;
  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
      props.renderWidget(<Widget />);
      break;
    default:
      break;
  }
}
