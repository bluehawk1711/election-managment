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
  // Roll areas — the dataset selector at the top of the voters header.
  // One area for now; the pill stays so the second one is a data change.
  'areas.label': 'Area',
  'areas.veernagar': 'Veernagar',

  // Update gate — the full-screen lock rendered when this build's
  // `app.json → version` compares below `appConfig/general.requiredVersion`.
  'update.title': 'App update required',
  'update.body':
    'This app version ({version}) is older than the required {required}. Please update to continue — your data stays safe.',
  'update.yourVersion': 'Your version',
  'update.requiredVersion': 'Required',
  'update.cta': 'Ask for the update on WhatsApp',
  'update.whatsappMessage':
    'Hi, I need the new update of the app (latest version {version}).',
  'update.noContact':
    'No support number configured yet — contact your super admin for the update.',
  'update.retry': 'Check again',
  'update.checking': 'Checking…',

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
  'common.address': 'Address',
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
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.showPassword': 'Show password',
  'common.hidePassword': 'Hide password',

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
  'nav.voters': 'Voters',
  'nav.reports': 'Reports',
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

  // Forms & pickers
  'common.next': 'Next',
  'common.weekdays.Mon': 'Mon',
  'common.weekdays.Tue': 'Tue',
  'common.weekdays.Wed': 'Wed',
  'common.weekdays.Thu': 'Thu',
  'common.weekdays.Fri': 'Fri',
  'common.weekdays.Sat': 'Sat',
  'common.weekdays.Sun': 'Sun',
  'form.selectWard': 'Select ward',
  'form.selectArea': 'Select area',
  'form.selectBooth': 'Select booth',
  'form.selectWardFirst': 'Select a ward first',
  'form.selectAreaFirst': 'Select an area first',

  // Dashboard
  'dash.brandTitle': 'Campaign Ops',
  'dash.greetingMorning': 'Good morning, {{name}}',
  'dash.greetingAfternoon': 'Good afternoon, {{name}}',
  'dash.greetingEvening': 'Good evening, {{name}}',
  'dash.campaignDay': 'Campaign Day {{day}}',
  'dash.pollingIn': '{{days}} days to polling',
  // Election-day banner (one date, `campaigns/active.electionDate`, shared by
  // the whole team — see lib/election.ts for how the four states are decided).
  'dash.electionTitle': 'Election day',
  'dash.electionTomorrow': 'Voting day is tomorrow',
  'dash.electionDays': '{{days}} days to voting day',
  'dash.electionToday': 'Voting day',
  'dash.electionPassed': 'Voting day was on {{date}}',
  'dash.electionAgo': '{{days}} days ago',
  'dash.electionUnset': 'No election day set',
  'dash.electionUnsetHint':
    'Set the date and everyone on the team counts down to it.',
  'dash.electionSetAction': 'Set date',
  'dash.electionChangeAction': 'Change',
  // The picker the banner and Settings both open.
  'election.title': 'Set election day',
  'election.hint':
    'One date for the campaign: the whole team sees it on the dashboard.',
  'election.day': 'Day',
  'election.month': 'Month',
  'election.year': 'Year',
  'election.invalid': 'That is not a real date — try 12 02 2027.',
  'election.saved': 'Election day saved',
  'election.cleared': 'Election day cleared',
  'election.failed': 'Could not save the election day',
  'election.clear': 'Clear date',
  'election.pending': 'Saving…',
  'dash.notifications': 'Notifications',
  'dash.noNotifications': 'No new notifications yet',
  'dash.settings': 'Settings',
  'dash.readiness': 'Campaign Readiness',
  'dash.trendWeek': '{{trend}} this week',
  'dash.index': 'Index',
  'dash.boothsCovered': 'Booths covered',
  'dash.activeWorkers': 'Active workers',
  'dash.tasksDoneToday': 'Tasks done today',
  'dash.newTask': 'New Task',
  'dash.reportIssue': 'Report Issue',
  'dash.addEvent': 'Add Event',
  'dash.boothIn': 'Booth report',
  'dash.metricPendingTasks': 'Pending tasks',
  'dash.metricOpenIssues': 'Open civic issues',
  'dash.metricMeetings': 'Meetings this week',
  'dash.metricExpenses': 'Expenses logged',
  'dash.taskCompletion': 'Task completion',
  'dash.taskCompletionSub': 'Velocity vs weekly operational benchmark',
  'dash.rangeLabel': '{{days}}D',
  'dash.doneUnit': 'done',
  'dash.coverage': 'Booth coverage by ward',
  'dash.coverageSub': 'Target threshold: {{percent}}% per sector',
  'dash.wardsCount': '{{count}} Wards',
  'dash.issuesByCategory': 'Issues by category',
  'dash.issuesSub': 'Grievance distribution across voter desks',
  'dash.totalIssues': 'Total Issues',
  'dash.attention': 'Needs attention',
  'dash.attentionCount': '{{count}} Action Items',
  'dash.assign': 'Assign',
  'dash.nudge': 'Nudge',
  'dash.escalate': 'Escalate',
  'dash.boothTitle': 'Booth {{number}}',
  'dash.noCoordinator': 'No coordinator assigned',
  'dash.taskOverdue': 'Task overdue',
  'dash.schedule': 'Upcoming schedule',
  'dash.calendarSync': 'Calendar Sync Active',
  'dash.calendarLocal': 'Calendar (this device)',
  'dash.recentActivity': 'Recent activity',
  'dash.liveStream': 'Live stream',
  'dash.actTask': 'updated "{{title}}"',
  'dash.actExpense': 'logged {{amount}} expense',
  'dash.actIssue': 'reported "{{title}}"',
  'dash.unknownActor': 'Campaign desk',
  'dash.live': 'Live from Firestore',
  'dash.cached': 'Serving from cache…',

  // Issue categories (shared by dashboard, issues, reports)
  'issues.cat.road': 'Road repair',
  'issues.cat.water': 'Water supply',
  'issues.cat.electricity': 'Electricity',
  'issues.cat.drainage': 'Drainage',
  'issues.cat.streetlight': 'Streetlight',
  'issues.cat.sanitation': 'Sanitation',

  // Expense categories
  'expenses.cat.travel': 'Travel',
  'expenses.cat.fuel': 'Fuel',
  'expenses.cat.materials': 'Materials',
  'expenses.cat.printing': 'Printing',
  'expenses.cat.food': 'Food',
  'expenses.cat.venue': 'Venue',
  'expenses.cat.other': 'Other',

  // Tasks module
  'tasks.title': 'Task',
  'tasks.create': 'New task',
  'tasks.createdToast': 'Task created',
  'tasks.emptyBody': 'Create the first task for your team and assign it to a worker.',
  'tasks.noMatches': 'No matching tasks',
  'tasks.noMatchesBody': 'Try a different search or clear the filters.',
  'tasks.dueOverdue': 'Overdue',
  'tasks.report': 'Field report',
  'tasks.reportHint': 'Add notes from the field…',
  'tasks.titleRequired': 'Title is required',
  'tasks.titlePlaceholder': 'e.g. Poster distribution at Ward 12',
  'tasks.descriptionPlaceholder': 'What needs to be done?',
  'tasks.assigneePlaceholder': 'Unassigned',
  'tasks.createHint': 'Status starts as Pending — move it from the task screen.',

  // Booths module
  'booths.count': '{{count}} booths',
  'booths.ready': 'Ready',
  'booths.unassigned': 'Unassigned',
  'booths.noCoordinator': 'No coordinator assigned',
  'booths.coordinator': 'Coordinator',
  'booths.assignHint': 'Pick someone from the team roster — changes save instantly.',
  'booths.assignedToast': 'Coordinator assigned',
  'booths.clearedToast': 'Coordinator removed',
  'booths.workers': '{{count}} workers',
  'booths.estimatedVoters': 'Est. voters',
  'booths.voters': 'Voters',
  'booths.issues': 'Issues',
  'booths.votersEmpty': 'No voters synced for this booth yet.',
  'booths.tasksEmpty': 'No tasks assigned to this booth yet.',
  'booths.issuesEmpty': 'No issues reported for this booth yet.',
  'booths.emptyBody': 'Booths appear here once the campaign geography is seeded.',
  'booths.noMatches': 'No matching booths',
  'booths.noMatchesBody': 'Try a different search or clear the filters.',

  // Voter roll (plan-voters.md §6.1–6.3)
  'voters.title': 'Voter Roll',
  'voters.count': '{{count}} voters',
  'voters.searchPlaceholder': 'Search in English or Hindi — name, EPIC…',
  'voters.searchIn': 'Search in',
  'voters.searchScope.name': 'Name',
  'voters.searchScope.father': 'Father name',
  'voters.searchScope.locality': 'Locality',
  'voters.searchScope.other': 'Other fields',
  'voters.ageFilter': 'Age group',
  'voters.ageAny': 'Any age',
  'voters.ageYoung': '18–25',
  'voters.ageAdult': '26–40',
  'voters.ageMid': '41–60',
  'voters.ageSenior': '60+',
  'voters.nearby': 'Nearest to me',
  'voters.nearbyOff': 'Turn off nearest mode',
  'voters.nearbyLocating': 'Finding your location…',
  'voters.nearbyDenied': 'Location permission is needed to find nearby voters.',
  'voters.nearbyNone':
    'No voters have a recorded location yet. Capture one from a voter detail screen.',
  'voters.nearbyNoneScoped': 'No located voters in this ward or search.',
  'voters.ward': 'Ward {{no}}',
  'voters.emptyBody': 'The roll loads from the bundled data when a ward is opened.',
  'voters.noMatches': 'No matching voters',
  'voters.noMatchesBody':
    'Try a different search, or widen "Search in" above to the father name or locality.',
  'voters.moreResults': 'Showing {{shown}} of {{total}} matches — refine the search to narrow it down.',
  'voters.backToTop': 'Back to top',
  'voters.errorBody': 'The roll could not be read.',
  'voters.serial': 'Serial {{no}}',
  'voters.epic': 'EPIC ID',
  'voters.age': 'Age',
  'voters.gender': 'Gender',
  'voters.genderOption.male': 'Male',
  'voters.genderOption.female': 'Female',
  'voters.genderOption.other': 'Other',
  'voters.house': 'House no.',
  'voters.locality': 'Locality',
  'voters.father': 'Father / husband',
  'voters.relation': 'Relation',
  'voters.pdfPage': 'Source page {{no}}',
  'voters.rollInfo': 'Roll details',
  'voters.fieldwork': 'Field data',
  'voters.voted': 'Voted',
  'voters.votedYes': 'Voted',
  'voters.votedNo': 'Not voted',
  'voters.votedUnknown': 'Not marked',
  'voters.leaning': 'Political leaning',
  'voters.leaningNote': 'Leaning note',
  'voters.leaning.right': 'Right wing',
  'voters.leaning.centerRight': 'Centre-right',
  'voters.leaning.center': 'Centre',
  'voters.leaning.centerLeft': 'Centre-left',
  'voters.leaning.left': 'Left wing',
  'voters.leaning.unknown': 'Not recorded',
  'voters.leaningNotePlaceholder': 'Optional detail…',
  'voters.jati': 'Jati (caste)',
  'voters.jatiPlaceholder': 'e.g. Rajput, Jat, Brahmin…',
  'voters.support': 'Support',
  'voters.support.unknown': 'Not recorded',
  'voters.support.supporter': 'Supporter',
  'voters.support.opponent': 'Opponent',
  'voters.photo': 'Photo',
  'voters.addPhoto': 'Add photo',
  'voters.replacePhoto': 'Replace photo',
  'voters.photoUploading': 'Uploading…',
  'voters.photoFailed': 'Photo upload failed — try again.',
  'voters.photoSavedLocally': 'Photo saved on this device.',
  'voters.location': 'Location',
  'voters.addLocation': 'Use current location',
  'voters.locating': 'Locating…',
  'voters.locationFailed': 'Could not read your location.',
  'voters.openMaps': 'Open in Maps',
  'voters.openMapsFailed': 'No app could open these coordinates.',
  'voters.locationAccuracy': '±{{m}} m',
  'voters.locationNoAccuracy': 'Accuracy unknown',
  'voters.locationTaken': 'Captured {{when}}',
  'voters.locationNone': 'No location recorded yet — tap to capture one.',
  'voters.contact': 'Contact',
  'voters.noPhone': 'No phone number recorded',
  'voters.call': 'Call',
  'voters.message': 'Message',
  'voters.whatsapp': 'WhatsApp',
  'whatsapp.title': 'WhatsApp message',
  'whatsapp.hint': 'Write what you want to send — or leave it empty to just open the chat.',
  'whatsapp.placeholder': 'Message (optional)',
  'whatsapp.open': 'Open WhatsApp',
  'voters.edit': 'Edit voter',
  'voters.pendingSync': 'Pending sync',
  'voters.teamEdit': 'Team',
  'voters.teamEditBy': 'By {{name}}',
  'voters.teamTakeTitle': '{{name}} filled these details in',
  'voters.teamTakeTitleAnon': 'A teammate filled these details in',
  'voters.teamTakeIntro': 'They are on your team, so their entry shows here too. Save a copy to keep it on your own account — your own values always win.',
  'voters.teamTakeAction': 'Save to my account',
  'voters.teamTaken': 'Saved {{count}} details to your account.',
  'voters.bulkPhone': 'Bulk phone',
  'voters.selectedCount': '{{count}} selected',
  'voters.bulkIntro': 'Set a phone number on many voters at once, or paste an EPIC list. Every write goes through the normal edit path, so it syncs to your account like any other change.',
  'voters.bulkLoading': 'Loading the roll…',
  'voters.bulkPaste': 'Paste EPIC, phone list',
  'voters.bulkPasteHint': 'One per line: EPIC id, then a 10-digit number (comma, space or tab between them).',
  'voters.bulkMatched': '{{matched}} of {{total}} lines matched this roll.',
  'voters.bulkUnmatched': 'Not found: {{epics}}',
  'voters.bulkNoneMatched': 'None of those EPIC ids exist in this roll.',
  'voters.bulkBadPhone': 'Enter a valid number (at least 10 digits).',
  'voters.bulkApplied': 'Phone updated on {{count}} voters.',
  'voters.bulkPerVoter': 'Every voter below gets their own number — edit any row, leave a row empty to skip it.',
  'voters.bulkSharedNumber': 'One number for everyone',
  'voters.bulkFillAll': 'Fill all rows',
  'voters.bulkRowsReady': '{{ready}} of {{total}} rows have a usable number.',
  'voters.bulkInvalidRows': 'That number looks wrong for: {{names}}{{extra}}',
  'voters.bulkUpdateCount': 'Update {{count}} voters',
  'voters.bulkNoSelection': 'Long-press voters in the list to tick them, then bring them here. Every phone number counts as a field edit and syncs to your account.',
  'voters.applyToHouse': 'Set for this whole house ({{count}})',
  'dash.fieldwork': 'My fieldwork',
  'dash.fwCoverage': '{{done}} of {{total}} voters edited',
  'dash.fwEdited': 'Edited',
  'dash.fwPhones': 'Phones',
  'dash.fwPhotos': 'Photos',
  'dash.fwVoted': 'Voted',
  'dash.fwPending': '{{count}} changes syncing to your account',
  'voters.savedLocally': 'Saved on this device',
  'voters.phoneHint': 'The roll carries no phone numbers — add one here.',
  'voters.addPhone': 'Add phone number',
  'voters.changePhone': 'Change phone number',
  // The consolidated "Mobile number" card on the edit screen: title, hint,
  // inline validation, the instant Save/Remove pair and its state line.
  'voters.phoneCardTitle': 'Mobile number',
  'voters.phoneCardHint':
    'Type a number and tap Save — it saves instantly for this voter. Remove erases it.',
  'voters.phoneInvalid': 'Enter a valid mobile number (6–15 digits)',
  'voters.savePhone': 'Save number',
  'voters.removePhone': 'Remove',
  'voters.phoneSaved': 'Number saved for this voter.',
  'voters.phoneUnsaved': 'Unsaved changes — tap Save number.',
  'voters.phoneEmpty': 'No number saved yet.',
  // Shared phone numbers — proposals from the whole team, with the super
  // admin's chosen number marked "In use" (the one the action buttons dial).
  'voters.phoneNumbers': 'Phone numbers',
  'voters.phoneNumbersHint':
    'Numbers proposed by the team. The number in use is what the buttons below dial.',
  'voters.numberInUse': 'In use',
  'voters.numberAddedBy': 'Added by {{name}}',
  'voters.useNumber': 'Use this number',
  'voters.stopUsingNumber': 'Take out of use',
  'voters.chosenBy': 'Chosen by {{name}}',
  'voters.noNumbers': 'No numbers proposed yet — enter one below and save.',
  'voters.dialingChosen': 'Dialling the chosen number',
  'voters.notes': 'Notes',
  'voters.notesPlaceholder': 'Anything the team should know…',
  'voters.photoPermission': 'Photo library permission is needed to attach a photo.',
  // Card placeholder — the box drawn in place of a photo that has not been
  // taken yet, so an unphotographed voter reads as "not yet captured" rather
  // than as a broken image.
  'voters.noPhoto': 'No photo',
  // Label for the distance row on the card, shown only in nearest-voter mode.
  'voters.distance': 'Distance',

  // Roll freshness / offline. `useRoll` serves the device cache first and
  // refetches in the background, so the list is readable before the network
  // answers — this banner is what tells the user which copy they are reading.
  'roll.offline': 'Offline — showing the roll saved on this device',
  'roll.refreshing': 'Updating…',
  'roll.cachedAt': 'Saved on this device {{when}}',
  'roll.fresh': 'Up to date',

  // No role yet. Every signed-in account starts with no capabilities, so this
  // is a real state a user lands on, not an error case.
  'common.noRoleTitle': 'No role assigned yet',
  'common.noRoleBody':
    'An admin has to assign you a role and ward before the voter roll becomes visible. Ask your campaign coordinator.',

  // Voter edit sheet
  'voters.editHint': 'Edits save to your account — sign in anywhere and they come back.',
  'voters.noChanges': 'Nothing to save — no field changed.',
  'voters.saved': 'Saved to this device',
  // The one field that shipped with no placeholder: an empty box beside an
  // "Age" caption read as a label, not a place to type a number.
  'voters.agePlaceholder': 'e.g. 33',
  'voters.ageInvalid': 'Age must be a number between 18 and 100.',
  'voters.revert': 'Discard local edit',
  'voters.reverted': 'Local edit discarded',

  // Booth report (plan-voters.md §6.4)
  'reports.title': 'Booth Report',
  'reports.total': 'Total voters',
  'reports.turnout': 'Turnout',
  'reports.marked': 'Marked',
  'reports.notMarked': 'Not marked',
  'reports.photos': 'Photos added',
  'reports.pending': 'Edits pending sync',
  'reports.male': 'Male',
  'reports.female': 'Female',
  'reports.third': 'Third gender',
  'reports.room': 'Room',
  'reports.emptyBody': 'Mark voters as voted from a voter\'s detail screen and the report fills in here.',
  'reports.tally': '{{count}} of {{total}}',
  'reports.openWard': 'Open ward {{no}}',
  'reports.assignedOnly': 'You are assigned to Ward {{no}}, so only that booth shows here.',

  // Accounts (plan-voters.md §6.5 / §7)
  'accounts.title': 'Accounts',
  'accounts.create': 'Create account',
  'accounts.displayName': 'Display name',
  'accounts.email': 'Email',
  'accounts.password': 'Password',
  'accounts.role': 'Role',
  'accounts.wardScope': 'Assigned ward',
  'accounts.noWardScope': 'All wards',
  'accounts.created': 'Account created',
  // Written for a vault that did not exist when it was first phrased: the
  // password is still worth handing over *now*, but it is no longer
  // unrecoverable — the account's own row reopens it from this device.
  'accounts.createdHint':
    'Hand the credentials over now, or open the account from the list later — this device keeps its own copy.',
  'accounts.credentialsDeviceOnly':
    'Saved on this device only. Nothing is sent to the server, so no other device can show it.',
  'accounts.passwordNotStored':
    'This device has no password for that account — it was created elsewhere (or the save failed), so there is nothing to copy here.',
  'accounts.passwordNotForRole':
    'Passwords are only shown to super admins, who are the ones allowed to manage accounts.',
  'accounts.failed': 'Account creation failed',
  'accounts.emptyBody': 'No accounts have been created yet.',
  'accounts.superAdminOnly': 'Only a super admin can create accounts.',
  'accounts.yourRole': 'Your role: {{role}}. Accounts are created by super admins and developers — ask yours to add the karyakarta, or open this screen signed in as one.',
  'accounts.emailInvalid': 'Enter a valid email address.',
  'accounts.passwordShort': 'Password must be at least 6 characters.',
  'accounts.nameRequired': 'Display name is required.',
  'accounts.empty': 'No accounts yet',
  'accounts.roleRequired': 'Pick a role.',
  'accounts.wardRequired': 'A karykarta must be assigned a ward.',
  'accounts.updated': 'Account updated',
  'accounts.updatedHint': '{{name}} is now {{role}}.',
  'accounts.cantEditSelf': 'You cannot change your own role.',
  'accounts.listDenied':
    'Admins and super admins can view accounts. Ask your campaign coordinator for access.',

  // Roles
  'role.karykarta': 'Karykarta',
  'role.admin': 'Admin',
  'role.superAdmin': 'Super admin',
  'role.developer': 'Developer',
  'role.none': 'No role assigned',

  // More hub + settings
  'more.title': 'More',
  'more.accounts': 'Accounts',
  'more.accountsHint': 'Create accounts and assign roles',
  'more.settings': 'Settings',
  'more.settingsHint': 'Language, profile and local data',
  'more.issues': 'Issues',
  'more.newIssue': 'Report issue',
  'more.expenses': 'Expenses',
  'more.newExpense': 'Add expense',

  // Issues module (the dashboard's "Report Issue" lands here)
  'issues.create': 'Report issue',
  'issues.createdToast': 'Issue reported',
  'issues.emptyBody':
    'Report a civic issue — water, roads, streetlights — and walk it to resolution.',
  'issues.noMatches': 'No matching issues',
  'issues.noMatchesBody': 'Try a different search or clear the filters.',
  'issues.titlePlaceholder': 'e.g. Streetlight out on Ward 4 main road',
  'issues.titleRequired': 'Title is required',
  'issues.descriptionPlaceholder': 'What happened, and where exactly?',
  'issues.advanceHint': 'Tap an issue to advance it: Open → In progress → Resolved.',

  // Expenses module (the dashboard's expense tile lands here)
  'expenses.create': 'Add expense',
  'expenses.createdToast': 'Expense logged',
  'expenses.emptyBody':
    'Log campaign spending — travel, fuel, printing — so the audit trail stays complete.',
  'expenses.noMatches': 'No matching expenses',
  'expenses.noMatchesBody': 'Try a different search or clear the filters.',
  'expenses.amount': 'Amount (₹)',
  'expenses.amountRequired': 'Enter an amount greater than zero',
  'expenses.amountPlaceholder': 'e.g. 250',
  'expenses.totalLabel': 'Total logged',
  'expenses.descriptionPlaceholder': 'What was it for?',
  'expenses.date': 'Date',
  'more.language': 'Language',
  'more.languageHint': 'Choose the language the app is shown in',
  'more.profile': 'Profile',
  'more.localData': 'Local data',
  'more.clearCache': 'Clear cached roll',
  'more.clearCacheHint': 'Downloaded voter roll. Your own edits are kept.',
  'more.cacheCleared': 'Cached roll cleared',
  'more.signOut': 'Sign out',

  // ── More hub: Help ────────────────────────────────────────────────────
  // The in-app manual. One section open at a time; every answer is written
  // for field use and mirrored key-for-key in hi.ts.
  'more.help': 'Help & guides',
  'more.helpHint': 'How everything works, in full',
  'help.intro':
    'Tap a section to open it. Every answer is written for field use — if something is still unclear, use the button at the bottom.',
  'help.start': 'Getting started',
  'help.roll': 'The voter roll',
  'help.edit': 'Editing a voter',
  'help.phones': 'Phone numbers',
  'help.fieldwork': 'Fieldwork on the voter card',
  'help.tasks': 'Tasks',
  'help.events': 'Calendar & events',
  'help.issues': 'Issues',
  'help.expenses': 'Expenses',
  'help.team': 'Team & roles',
  'help.sync': 'Sync, offline & devices',
  'help.trouble': 'Troubleshooting',
  'help.privacy': 'Your data & privacy',
  'help.contact': 'Still stuck?',
  'help.contactBody':
    'Message the campaign support team on WhatsApp — the number is set by the team admin, so it always reaches the right person.',
  'help.contactAction': 'Open WhatsApp support',

  'help.q.start.1': 'How do I sign in?',
  'help.a.start.1':
    'Use the email and password your super admin created for you. There is no self sign-up — if you do not have an account yet, ask your super admin to create one; they choose the password and hand it to you.',
  'help.q.start.2': 'What does my role decide?',
  'help.a.start.2':
    'Karykarta: the voters of your assigned ward, their edits, tasks and fieldwork.\nAdmin: everything a karykarta sees, plus issues, expenses and the team roster.\nSuper admin: all of it, plus creating accounts, changing roles, locking accounts and resetting passwords.\nDeveloper: full access, for technical setup.',
  'help.q.start.3': 'What should I do first?',
  'help.a.start.3':
    'Open Settings (More tab) and check your language and appearance. Then open Voters and search for one person you know — that single search teaches you the roll. The dashboard tiles all lead somewhere: tap any of them.',

  'help.q.roll.1': 'What exactly is the roll?',
  'help.a.roll.1':
    'The official voter list for the panchayat — every voter with serial number, EPIC id, name, relation, house number, age, gender and locality, bundled inside the app itself. Because it lives on your phone, it works with no internet at all. The roll is read-only: your corrections are stored as edits on top of it, never by changing the original rows.',
  'help.q.roll.2': 'How do I find someone quickly?',
  'help.a.roll.2':
    'Voters tab → search field. Switch the mode chip to Name, Father/Husband name or Locality — the same three ways you would ask about a person in the field. Type part of the word; spelling does not have to be exact. The EPIC number also matches if you have the card in hand.',
  'help.q.roll.3': 'What do the chips on a voter card mean?',
  'help.a.roll.3':
    'With us / Against us is that voter\u2019s support. The leaning chip is where they sit on the political spectrum. "Voted" means their turnout is confirmed. "Pending sync" means this voter has edits still waiting to upload from your device — they are safe locally.',

  'help.q.edit.1': "How do I correct someone's details?",
  'help.a.edit.1':
    'Tap the voter\u2019s card — the edit screen opens. Fix the name, house number, age, gender, locality or notes, then press Save at the bottom. The change is stored on your device instantly ("Saved on this device") and then mirrored to your account so your other devices see it.',
  'help.q.edit.2': 'Why is the mobile number in its own card?',
  'help.a.edit.2':
    'Because it is the field most people came for. The Mobile number card has its own Save number and Remove buttons that take effect immediately — they do not wait for the main Save. The main Save can be blocked by an invalid age on the roll row; the phone card never is.',
  'help.q.edit.3': 'I edited offline — did it save?',
  'help.a.edit.3':
    'Yes. Everything is written to the device first. A "Pending sync" chip on the card and a queue counter under the Save button show how many changes are waiting; they upload by themselves the next time you have internet.',

  'help.q.phones.1': 'The roll has no numbers — how do I add one?',
  'help.a.phones.1':
    'Open the voter, type the number in the Mobile number card, tap Save number. If the same number belongs to the whole family, the card offers "Apply to house" — one tap writes it to every member with the same house number in your ward.',
  'help.q.phones.2': 'What is the team numbers board?',
  'help.a.phones.2':
    'Below the input, every number ANY team member proposed for this voter appears with who added it and when — your number and a super admin\u2019s sit side by side instead of overwriting each other. Each row dials directly. A super admin can mark one number "In use": that is what the dial buttons use by default.',
  'help.q.phones.3': 'How do I update many numbers at once?',
  'help.a.phones.3':
    'Voters tab → long-press a card to start ticking, tick everyone sharing the number, then "Bulk phone". Or choose the paste option and drop in "EPIC, phone" lines — one per line — and every matching voter is updated together.',

  'help.q.fieldwork.1': 'Voted, Support and Leaning — how do they save?',
  'help.a.fieldwork.1':
    'One tap, saved immediately — no Save button needed. Voted records turnout (voted / not voted / unknown). Support says with us or against us and colours the card. Leaning places the voter on the five-step spectrum. Tapping the already-selected option leaves it as it is.',
  'help.q.fieldwork.2': 'How do I attach a photo?',
  'help.a.fieldwork.2':
    'On the edit screen the empty photo box opens the gallery — pick a picture (with the person\u2019s consent). An existing photo opens full-screen on tap; the caption below it replaces it. Photos stay on your device first, so they work offline.',
  'help.q.fieldwork.3': 'How does location work?',
  'help.a.fieldwork.3':
    'The Location card on the edit screen has an "Add location" button that captures your current GPS position with its accuracy and time — meant for marking a booth, a household or a meeting point. Once captured it shows the coordinates and an "Open maps" link.',

  'help.q.tasks.1': 'How do I create a task?',
  'help.a.tasks.1':
    'More → Tasks → New. Give it a title and description, pick who it is assigned to, optionally the ward, area or booth, and a due date. It appears on the assignee\u2019s dashboard immediately.',
  'help.q.tasks.2': 'What do the statuses mean?',
  'help.a.tasks.2':
    'Pending — created, not started. In progress — being worked on. Completed — done (the dashboard\u2019s 30-day chart counts these). Issue — blocked; the report field is where you say what is blocking it.',
  'help.q.tasks.3': 'Who sees my task?',
  'help.a.tasks.3':
    'The person you assigned it to, plus admins and super admins. A karykarta only sees tasks in their own ward, so assign accordingly.',

  'help.q.events.1': 'How do events work?',
  'help.a.events.1':
    'More → Calendar → New event: a meeting, rally, door-to-door round or the polling day itself. Every upcoming event appears on the dashboard schedule card, and the days-to-polling countdown comes from the election date set on the campaign.',
  'help.q.events.2': 'Can events sync to my phone calendar?',
  'help.a.events.2':
    'The dashboard shows whether calendar sync is connected. When it is, adding an event also writes it to your phone\u2019s calendar; when it is not, events live in the app only.',

  'help.q.issues.1': 'How do I report an issue?',
  'help.a.issues.1':
    'More → Issues → New issue. Pick the category — road, water, electricity, drainage, streetlight or sanitation — say what is wrong and where. It lands on the dashboard\u2019s open-issues count and category breakdown straight away.',
  'help.q.issues.2': 'How does an issue get closed?',
  'help.a.issues.2':
    'Anyone with access can move it to resolved; the dashboard tracks the resolution rate, so closing issues is how the campaign sees progress.',

  'help.q.expenses.1': 'How do I record an expense?',
  'help.a.expenses.1':
    'More → Expenses → New expense: amount, category (travel, fuel, materials, printing, food, venue or other), a note and the date. Totals roll up onto the dashboard tile and its seven-day sparkline.',
  'help.q.expenses.2': 'Who can see expenses?',
  'help.a.expenses.2':
    'Everyone who can see the module sees the campaign total; recording here rather than on paper is what makes the whole team\u2019s spending add up in one place.',

  'help.q.team.1': 'Who can create accounts?',
  'help.a.team.1':
    'Only a super admin (More → Accounts → New account). Only super admins and developers can change roles, lock accounts or reset passwords. Admins can view the roster but not change it.',
  'help.q.team.2': 'What does the ward restriction mean?',
  'help.a.team.2':
    'A karykarta is assigned one ward: they read and edit only that ward\u2019s voters, tasks and field data. This is enforced by the database rules themselves, not just by hiding buttons.',
  'help.q.team.3': 'My colleague forgot their password — now what?',
  'help.a.team.3':
    'A super admin opens Accounts, finds the person and uses the key icon: they can check the stored password or set a new one on the spot, without knowing the old one. The new password works at the next sign-in on every device.',

  'help.q.sync.1': 'Does the app work without internet?',
  'help.a.sync.1':
    'Yes — the roll, your edits, photos and locations all live on the phone. Tasks, issues and expenses you create are queued and upload when you are back online. "Pending sync" chips mark exactly what is waiting.',
  'help.q.sync.2': 'Why did my account lock itself?',
  'help.a.sync.2':
    'One account works on one device. If the same account signs in somewhere else, the first device is locked out automatically (the "device change" lock) — it protects voter data on a lost or shared phone. A super admin unlocks it and the rightful device binds again at sign-in.',
  'help.q.sync.3': 'What is the "Update required" screen?',
  'help.a.sync.3':
    'The team admin sets a minimum app version in the admin panel. When your installed version is older, the app opens locked behind that screen until you update — the Update button opens WhatsApp to the support number with a ready message.',
  'help.q.sync.4': 'The pending counter will not clear.',
  'help.a.sync.4':
    'It needs internet once: open the app with a connection and the queue uploads on its own. If it stays after that, note the number and message support — your edits are safe on the device either way.',

  'help.q.trouble.1': 'I cannot sign in.',
  'help.a.trouble.1':
    'Check the email and password exactly as they were given. If it still fails, the account may be locked (device change) — only a super admin can unlock it. Self sign-up does not exist; an account must be created for you.',
  'help.q.trouble.2': 'A screen is empty or missing things.',
  'help.a.trouble.2':
    'That is almost always your role: a karykarta sees their ward only, and someone with no role yet sees almost nothing. Settings shows your current role and ward; ask a super admin to correct them if they are wrong.',
  'help.q.trouble.3': 'Saving fails or a button does nothing.',
  'help.a.trouble.3':
    'A locked account cannot write anything — admins see the lock on the Accounts list. Otherwise retry once with internet; if it persists, the error text is what support needs.',
  'help.q.trouble.4': 'The roll itself has a mistake.',
  'help.a.trouble.4':
    'The imported roll is read-only on purpose — it mirrors the official list. Correct the person through their edit screen so the fix travels with your account, and report the discrepancy to the team.',

  'help.q.privacy.1': 'Where does my data live?',
  'help.a.privacy.1':
    'The roll is bundled inside the app. Everything you record — edits, photos, locations, tasks, expenses — goes to the campaign\u2019s own Firebase project, attached to your account, so admins can audit who recorded what.',
  'help.q.privacy.2': 'What should never be recorded?',
  'help.a.privacy.2':
    'Phone numbers only with the voter\u2019s consent, and photos the person is comfortable with. The app deliberately stores no religion, caste or party-affiliation fields — if you think a field asks for too much, tell support before filling it in.',

  'settings.title': 'Settings',
  'settings.account': 'Account',
  'settings.preferences': 'Preferences',
  'settings.appearance': 'Appearance',
  'settings.appearanceHint': 'Follows your phone by default.',
  'settings.mode.system': 'System',
  'settings.mode.light': 'Light',
  'settings.mode.dark': 'Dark',
  'settings.profile': 'Profile',
  'settings.displayName': 'Display name',
  'settings.displayNameHint': 'Shown next to anything you record in the field.',
  'settings.identity': 'Signed in',
  'settings.noDisplayName': 'No display name',
  // About card — the build's own version (Settings screen shows it next to
  // the update gate's requirement; photo upload was removed, so its old
  // 'changePhoto' key is gone with it).
  'settings.about': 'About',
  'settings.version': 'App version',
  'settings.signedInWith': 'Signed in with {{method}}',
  'settings.verifyTitle': 'Verify your email',
  'settings.verifyBody':
    'We sent a link to {{email}}. Until you open it, password recovery and some providers will not link to this account.',
  'settings.verifyResend': 'Resend the link',
  'settings.nameSaved': 'Display name saved',
  'settings.yourRole': 'Your role',
  'settings.yourWard': 'Your ward',
  'settings.allWards': 'All wards',
  // Account deletion (Settings → Account). The dialog itself used to hard-code
  // these in English while every other string on this screen went through
  // `t()` — on an app that defaults to Hindi, a destructive confirmation is the
  // last place to leave a reader guessing.
  'settings.deleteAccount': 'Delete account',
  'settings.deleteTitle': 'Delete your account?',
  'settings.deleteBody':
    'This removes your tasks, your avatar and your profile, then deletes the account itself. It cannot be undone.',
  'settings.deleteConfirm': 'Delete everything',
  'settings.deleteCancel': 'Keep my account',
  'settings.deletePending': 'Deleting…',
  'settings.deletePasswordLabel': 'Confirm your password',
  'settings.deletePasswordPlaceholder': 'Your password',
  'settings.deleteProviderNote':
    'You signed in with a provider, so Firebase needs a recent sign-in before it will delete the account. If this fails, sign out, sign back in, and try again straight away.',
  'settings.deleteFailed': 'Could not delete your account',
  'settings.deleteFailedPassword': 'Check your password and try again.',
  'settings.deleteFailedProvider':
    'Sign out, sign back in, and try again — Firebase requires a recent sign-in for this.',
} as const;

export type TranslationKey = keyof typeof en;
