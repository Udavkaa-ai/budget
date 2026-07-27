import { registerRootComponent } from 'expo';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import App from './App';
import { widgetTaskHandler } from './src/widget/widget-task-handler';

// Обработчик виджета регистрируем до корня — headless-задача виджета должна
// найти его сразу при загрузке бандла (без монтирования App).
registerWidgetTaskHandler(widgetTaskHandler);

registerRootComponent(App);
