export const SACRED_INTENT_STORAGE_KEY = 'sacred_intent';
export const MAIN_CHAIN_DURATION_KEY = 'main_timer_duration_preference';
export const AUX_CHAIN_DURATION_KEY = 'aux_timer_duration_preference';

export const MAIN_CHAIN_SESSION_KEY = 'main_chain_session';
export const AUX_CHAIN_SESSION_KEY = 'aux_chain_session';

export const AUTO_START_MAIN_KEY = 'auto_start_main_timer';

export const DEFAULT_TASK_CATEGORY = 'study';

export const TASK_CATEGORY_OPTIONS = [
  { value: 'study', label: 'Study' },
  { value: 'work', label: 'Work' },
  { value: 'reading', label: 'Reading' },
  { value: 'writing', label: 'Writing' },
  { value: 'coding', label: 'Coding' },
  { value: 'meditation', label: 'Meditation' },
  { value: 'exercise', label: 'Exercise' },
  { value: 'chores', label: 'Chores' },
  { value: 'custom', label: 'Custom' }
];

// Authorized emails for Private Pages
export const ADMIN_EMAILS = [
  'douglasj216@outlook.com',
  'wangxr1218@gmail.com'
];

export const isAuthorizedEmail = (email) => {
  if (!email) {
    return false;
  }

  const normalizedEmail = email.toLowerCase().trim();
  return ADMIN_EMAILS.some((allowedEmail) => allowedEmail.toLowerCase().trim() === normalizedEmail);
};

export const DOUGLAS_UID = 'WgCYHSWWZkRds1CpMaZkp0VEEEv1';
export const NANCY_UID = 'rjjpaW7VGOZ52yrNTsdW2bxKDQ62';

export const COUPLE_ACCOUNT_UIDS = [DOUGLAS_UID, NANCY_UID];

const COUPLE_DISPLAY_NAMES = {
  [DOUGLAS_UID]: 'Douglas',
  [NANCY_UID]: 'Nancy'
};

export const isCoupleAccountByUid = (uid) => COUPLE_ACCOUNT_UIDS.includes(uid);

export const getPartnerUid = (uid) => {
  if (uid === DOUGLAS_UID) return NANCY_UID;
  if (uid === NANCY_UID) return DOUGLAS_UID;
  return null;
};

export const getDisplayNameForUid = (uid) => COUPLE_DISPLAY_NAMES[uid] || 'Partner';
