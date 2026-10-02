/**
 * English resources — flat dotted keys.
 *
 * `TranslationKey` is derived from this object, so `t('...')` is fully typed
 * and a missing key is a TypeScript error. `__tests__/i18n-parity.test.ts`
 * guarantees Hindi covers the same key set.
 */
export const en = {
  // App / common
  'app.name': 'Election Campaign',
  'app.tagline': 'Campaign Operations',
  'common.save': 'Save',
  'common.saving': 'Saving…',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.add': 'Add',
  'common.create': 'Create',
  'common.close': 'Close',
  'common.confirm': 'Confirm',
  'common.back': 'Back',
  'common.search': 'Search',
  'common.filter': 'Filter',
  'common.filters': 'Filters',
  'common.clear': 'Clear',
  'common.apply': 'Apply',
  'common.reset': 'Reset',
  'common.retry': 'Try again',
  'common.loading': 'Loading…',
  'common.viewAll': 'View all',
  'common.none': 'None',
  'common.all': 'All',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.optional': 'Optional',
  'common.required': 'Required',
  'common.new': 'New',
  'common.actions': 'Actions',
  'common.status': 'Status',
  'common.category': 'Category',
  'common.date': 'Date',
  'common.deadline': 'Deadline',
  'common.area': 'Area',
  'common.ward': 'Ward',
  'common.booth': 'Booth',
  'common.name': 'Name',
  'common.description': 'Description',
  'common.amount': 'Amount',
  'common.location': 'Location',
  'common.phone': 'Phone',
  'common.assignee': 'Assignee',
  'common.details': 'Details',
  'common.overview': 'Overview',
  'common.today': 'Today',
  'common.tomorrow': 'Tomorrow',
  'common.thisWeek': 'This week',
  'common.thisMonth': 'This month',
  'common.earlier': 'Earlier',
  'common.updated': 'Updated {{when}}',
  'common.added': 'Added {{when}}',
  'common.ago': '{{time}} ago',
  'common.items': '{{count}} items',
  'common.of': '{{a}} of {{b}}',
  'common.empty': 'Nothing here yet',
  'common.deleteTitle': 'Delete {{name}}?',
  'common.deleteBody': 'This cannot be undone.',
  'common.savedToast': 'Saved',
  'common.deletedToast': 'Deleted',
  'common.errorTitle': 'Something went wrong',
  'common.notFound': 'Not found',

  // Auth & onboarding
  'auth.signIn': 'Sign in',
  'auth.signUp': 'Create account',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.forgot': 'Forgot password?',
  'auth.noAccount': 'New here?',
  'auth.haveAccount': 'Already have an account?',
  'onboarding.languageTitle': 'Choose your language',
  'onboarding.languageSubtitle': 'You can change this any time in Settings.',

  // Navigation (tab bar)
  'nav.home': 'Home',
  'nav.booths': 'Booths',
  'nav.tasks': 'Tasks',
  'nav.calendar': 'Calendar',
  'nav.more': 'More',

  // Dashboard (home tab)
  'home.title': 'Dashboard',
  'home.subtitle': '{{campaign}} · {{candidate}}',
  'home.openTasks': 'Open tasks',
  'home.openIssues': 'Open issues',
  'home.booths': 'Booths',
  'home.daysToPolling': 'Days to polling',
  'home.placeholder':
    "The full dashboard — turnout rails, booth coverage and today's timeline — lands in the next build phase.",

  // Status vocabulary
  'status.pending': 'Pending',
  'status.inProgress': 'In progress',
  'status.completed': 'Completed',
  'status.issue': 'Issue',
  'status.open': 'Open',
  'status.resolved': 'Resolved',
  'status.approved': 'Approved',
  'status.rejected': 'Rejected',
  'status.done': 'Done',
  'status.attention': 'Attention required',
  'status.active': 'Active',
  'status.inactive': 'Inactive',

  // Role vocabulary
  'role.coordinator': 'Coordinator',
  'role.worker': 'Field worker',
} as const;

export type TranslationKey = keyof typeof en;
