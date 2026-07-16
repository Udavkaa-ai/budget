import * as Haptics from 'expo-haptics';

// Единая тактильная отдача по всему приложению. Все вызовы «безопасные» —
// на устройствах без вибромотора просто ничего не произойдёт.
export const haptics = {
  select:  () => { Haptics.selectionAsync().catch(() => {}); },
  light:   () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); },
  medium:  () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); },
  success: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); },
  warning: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); },
};
