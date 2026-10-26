// ══════════════════════════════════════════════════════════════════
// NEGOTIATED CARE PLANS (NCP) & ASSESSMENT DETAILS (AD)
// Tables: care_plans, assessment_details (see care_plans_setup.sql)
// Records are stored as one JSON object per document (column "data").
// Nothing is cached in localStorage — these are confidential records.
// ══════════════════════════════════════════════════════════════════

const CP_FACILITY = 'HARMONY LIVING HOUSE ADULT FAMILY LLC';
function cpLogoUrl() { try { return new URL('harmony_living_house_logo.png', window.location.href).href; } catch (e) { return 'harmony_living_house_logo.png'; } }

// ── small helpers ──
function cpEsc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function cpToday() { return (typeof getWATodayStr === 'function') ? getWATodayStr() : new Date().toISOString().slice(0, 10); }
function cpFmt(d) {
  if (!d) return '';
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${parseInt(m[2])}/${parseInt(m[3])}/${m[1]}` : String(d);
}
function cpAddMonths(dateStr, n) {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1 + n, +m[3]));
  return d.toISOString().slice(0, 10);
}
function cpFirst(name) { return String(name || '').trim().split(/\s+/)[0] || 'Resident'; }
function cpLines(v) { return String(v || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean); }
function cpUser() { return (typeof currentUser !== 'undefined' && currentUser && currentUser.name) ? currentUser.name : ''; }
function cpPhone(s) { const m = String(s || '').match(/\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/); return m ? m[0].trim() : ''; }

// Parse "Jeanne Wilson (Sibling) — 360-591-1703" style contact strings
function cpParseContact(s) {
  s = String(s || '').trim();
  if (!s) return null;
  const phone = cpPhone(s);
  const relM = s.match(/\(([^)0-9]+)\)/);
  let rel = relM ? relM[1].trim() : '';
  let name = s.replace(phone, '').replace(/\([^)]*\)/g, '').replace(/[—–]+/g, ' ').replace(/\s-\s|\s-$|^-\s/g, ' ')
    .replace(/\s{2,}/g, ' ').trim().replace(/[-,:]+$/, '').trim();
  const isPhysician = /physician|doctor|\bdr\b/i.test(s);
  if (isPhysician) name = name.replace(/^(primary\s+)?physician\s*:?\s*/i, '').trim();
  if (!rel) { const r2 = name.match(/^(.*?)\s*-\s*([A-Za-z /]+)$/); if (r2) { name = r2[1].trim(); rel = r2[2].trim(); } }
  return { name, rel, phone, isPhysician };
}

// ══════════════════════════════════
// FORM FIELD BUILDERS (shared by both modals)
// Every input carries data-k="<key>" so values are collected generically.
// ══════════════════════════════════
const F = {
  text: (k, label, opts = {}) => `<div class="field ${opts.span ? 'span2' : ''}" style="margin:0;"><label>${label}</label><input type="${opts.type || 'text'}" data-k="${k}" placeholder="${cpEsc(opts.ph || '')}"></div>`,
  date: (k, label, opts = {}) => F.text(k, label, Object.assign({ type: 'date' }, opts)),
  area: (k, label, opts = {}) => `<div class="field ${opts.half ? '' : 'span2'}" style="margin:0;"><label>${label}${opts.hint ? ` <span class="cp-hint">${opts.hint}</span>` : ''}</label><textarea data-k="${k}" rows="${opts.rows || 3}" placeholder="${cpEsc(opts.ph || '')}"></textarea></div>`,
  check: (k, label) => `<label class="cp-check"><input type="checkbox" data-k="${k}"> <span>${label}</span></label>`,
  select: (k, label, options, opts = {}) => `<div class="field ${opts.span ? 'span2' : ''}" style="margin:0;"><label>${label}</label><select data-k="${k}"><option value="">— Select —</option>${options.map(o => `<option>${cpEsc(o)}</option>`).join('')}</select></div>`,
  radio: (k, label, options) => `<div class="field span2" style="margin:0;"><label>${label}</label><div class="cp-radios">${options.map(o => `<label class="cp-check"><input type="radio" name="cpr-${k}" data-k="${k}" value="${cpEsc(o[0])}"> <span>${o[1]}</span></label>`).join('')}</div></div>`,
  checks: (items) => `<div class="field span2" style="margin:0;"><div class="cp-checks">${items.map(i => F.check(i[0], i[1])).join('')}</div></div>`,
  section: (id, title, body, sub) => `<section class="cp-section" id="${id}"><div class="cp-section-head">${title}${sub ? `<span>${sub}</span>` : ''}</div><div class="form-grid cp-grid">${body}</div></section>`,
  rs: (prefix, residentHint, staffHint) => F.area(prefix + '_resident', 'Resident', { half: true, rows: 5, hint: residentHint || 'what the resident can do / needs' })
    + F.area(prefix + '_staff', 'Staff will', { half: true, rows: 5, hint: staffHint || 'one task per line' })
};

function cpCollect(root) {
  const d = {};
  root.querySelectorAll('[data-k]').forEach(el => {
    const k = el.getAttribute('data-k');
    if (el.type === 'checkbox') d[k] = el.checked;
    else if (el.type === 'radio') { if (el.checked) d[k] = el.value; else if (!(k in d)) d[k] = ''; }
    else d[k] = el.value;
  });
  return d;
}
function cpApply(root, d) {
  root.querySelectorAll('[data-k]').forEach(el => {
    const k = el.getAttribute('data-k');
    const v = d ? d[k] : undefined;
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.type === 'radio') el.checked = (v != null && String(v) === el.value);
    else el.value = v == null ? '' : v;
  });
}

// ══════════════════════════════════
// NCP SCHEMA (mirrors the Harmony Negotiated Care Plan form)
// ══════════════════════════════════
const NCP_PSYCH = [['ps_sleep', 'Sleep Disturbance'], ['ps_stm', 'Short-term Memory impairment'], ['ps_ltm', 'Long-term Memory impairment'], ['ps_decision', 'Decision making'], ['ps_disruptive', 'Disruptive behavior'], ['ps_assaultive', 'Assaultive'], ['ps_resistive', 'Resistive'], ['ps_depression', 'Depression'], ['ps_anxiety', 'Anxiety'], ['ps_disorientation', 'Disorientation'], ['ps_wandering', 'Wandering in home'], ['ps_exit', 'Exit Seeking'], ['ps_halluc', 'Hallucinations'], ['ps_delusions', 'Delusions']];
const NCP_TX = [['tx_oxygen', 'Oxygen use'], ['tx_pain', 'Pain'], ['tx_weight', 'Weight loss/gain'], ['tx_programs', 'Programs – MH, PT, OT'], ['tx_rom', 'Range of motion exercises'], ['tx_vitals', 'Monitor vitals']];
const NCP_ND = [['nd_oral', 'Oral'], ['nd_topical', 'Topical'], ['nd_eyedrops', 'Eye drops'], ['nd_inhalers', 'Inhalers'], ['nd_colostomy', 'Colostomy/Cath'], ['nd_sprays', 'Sprays'], ['nd_allergy', 'Allergy Kits'], ['nd_organizer', 'Meds Organizer'], ['nd_injections', 'Injections'], ['nd_wound', 'Wound care'], ['nd_oxygen', 'Oxygen']];
const NCP_SIGS = [['provider', 'Provider'], ['resident', 'Resident'], ['rep', 'Resident Representative'], ['cm', 'Case Manager']];
const NCP_MED_REFUSAL = ['Attempt to find out why they are refusing their medication.', 'Encourage them to take their medication.', 'Check back with them after 15 minutes.', 'Document on the back of the MAR the date and time it was refused and why.', 'Inform their Dr. of the refusal and document on the back of the MAR.'];
const NCP_MED_REFUSAL_NOTE = 'If the person giving the medication is a nurse or other health professional, acting in the scope of their practice is able to make a judgement about the impact of the resident’s refusal, whether independent or dependent with medication management, then the Dr. does not need to be notified.';
const NCP_UNIVERSAL = 'The formal and informal caregiver will use latex/plastic gloves when in contact with any secretions to prevent the spread of infection. Thorough hand washing with soap will be done before and after gloving. Gloves will be put on and discarded at the end of each task. If the primary care provider orders these gloves they can be paid for through the medical coupon.';
const NCP_PSYCH_FOOTER = 'Caregivers will monitor residents for signs of side-effects caused by medication and report any adverse reactions to their Dr. right away.';
const NCP_DEFAULT_AWAY = 'Place medications in a baggy and give them to the person accompanying resident along with information on the dosage, frequency, and any special instructions.';

const NCP_NAV = [['cp-demo', 'Demographics'], ['cp-contacts', 'Contacts'], ['cp-special', 'Specialty & Evacuation'], ['cp-medical', 'Medical'], ['cp-comm', 'Communication'], ['cp-meds', 'Medications'], ['cp-tx', 'Treatments'], ['cp-psych', 'Psych/Social'], ['cp-adl1', 'Mobility & Bed'], ['cp-adl2', 'Eating & Toileting'], ['cp-adl3', 'Dressing, Hygiene, Bathing'], ['cp-adl4', 'Body Care'], ['cp-misc', 'Misc & Activities'], ['cp-sign', 'Signatures']];

function ncpFormHTML() {
  const fam = [1, 2, 3].map(i => F.text(`fam${i}_name`, `Family/Friend ${i}`) + F.text(`fam${i}_rel`, 'Relationship') + F.text(`fam${i}_phone`, 'Phone') + `<div class="field" style="margin:0;align-self:end;">${F.check(`fam${i}_emergency`, 'Emergency Contact')}</div>`).join('');
  const pm = [1, 2, 3, 4].map(i => F.text(`pm${i}_med`, `Medication ${i}`) + F.text(`pm${i}_purpose`, 'Purpose') + F.text(`pm${i}_side`, 'Side effects', { span: true })).join('');
  const sigs = NCP_SIGS.map(s => F.text(`sig_${s[0]}_name`, `${s[1]} — name`) + F.date(`sig_${s[0]}_date`, 'Date signed') + F.date(`sig_${s[0]}_rev1`, 'Review date') + F.date(`sig_${s[0]}_rev2`, 'Review date')).join('');
  return [
    F.section('cp-demo', 'DEMOGRAPHICS',
      F.text('name', 'Name') + F.date('date_entered', 'Date Entered (admission)') + F.date('plan_date', 'Date of Care Plan') + F.date('date_discharged', 'Date Discharged')
      + F.date('dob', 'Date of Birth') + F.text('language', 'Primary Language', { ph: 'English' })),
    F.section('cp-contacts', 'CONTACTS',
      `<div class="cp-quad span2">${fam}</div>`
      + F.text('mh_name', 'Mental Health Provider') + F.text('mh_phone', 'Phone')
      + `<div class="cp-tri span2">${F.text('phys_name', 'Physician or Medical Group')}${F.text('phys_phone', 'Phone')}${F.text('phys_fax', 'Fax')}</div>`
      + `<div class="cp-tri span2">${F.text('pharm_name', 'Pharmacy')}${F.text('pharm_phone', 'Phone')}${F.text('pharm_fax', 'Fax')}</div>`),
    F.section('cp-special', 'SPECIALTY NEEDS & EMERGENCY EVACUATION',
      `<div class="cp-tri span2">${F.check('sn_dementia', 'Dementia')}${F.check('sn_mh', 'Mental Health')}${F.check('sn_dd', 'Developmental Disability')}</div>`
      + `<div class="cp-tri span2">${F.text('sn_dementia_note', 'Dementia — details')}${F.text('sn_mh_note', 'Mental Health — details', { ph: 'e.g. Depression' })}${F.text('sn_dd_note', 'Developmental Disability — details')}</div>`
      + F.radio('evac', 'Emergency Evacuation', [['independent', 'Independent — physically &amp; mentally capable of safely getting out of the home without assistance or mobility aids, AND with one verbal cue'], ['assistance', 'Assistance Required — not capable of getting out of the house without assistance from another individual or mobility aids']])
      + F.area('evac_instructions', 'Special Instructions', { rows: 2, ph: 'e.g. Transfer to a wheelchair and push to evacuate. Keep walkways clear.' })),
    F.section('cp-medical', 'CURRENT MEDICAL STATUS & HISTORY',
      F.area('medical_status', 'Current Medical Status', { rows: 4 })
      + F.area('diagnoses', 'Medical History / Diagnosis', { rows: 6, hint: 'one diagnosis per line' })
      + F.area('allergies', 'Allergies', { rows: 2 })),
    F.section('cp-comm', 'COMMUNICATION',
      F.checks([['comm_speech', 'Problems with speech'], ['comm_hearing', 'Hearing problems'], ['comm_vision', 'Vision problems']])
      + F.text('comm_phone', 'Telephone use', { span: true, ph: 'e.g. Assistance / Independent' })
      + F.rs('comm')),
    F.section('cp-meds', 'MEDICATION MANAGEMENT',
      F.radio('med_level', 'Level', [['independent', 'Independent'], ['assistance', 'Assistance'], ['delegation', 'Nurse Delegation']])
      + F.rs('med', 'how the resident takes medications', 'e.g. Inform her of each medication given')
      + `<div class="field span2" style="margin:0;"><label>Nurse delegation tasks</label><div class="cp-checks">${NCP_ND.map(n => F.check(n[0], n[1])).join('')}</div></div>`
      + F.text('nd_other', 'Other delegated task') + F.area('nd_staff', 'Delegated Staff will', { half: true, rows: 2 })
      + F.area('med_away', 'Medication plans when the resident is not in the home', { rows: 2 })
      + `<div class="cp-static span2"><strong>WAC 388-76-10435: Plan for Medication refusal</strong> is printed on every plan automatically.</div>`),
    F.section('cp-tx', 'TREATMENT / PROGRAMS / THERAPIES', F.checks(NCP_TX) + F.rs('tx')),
    F.section('cp-psych', 'PSYCH / SOCIAL / COGNITIVE STATUS',
      F.checks(NCP_PSYCH) + F.rs('ps')
      + `<div class="field span2" style="margin:0;"><label>Psychopharmacological medications</label></div><div class="cp-tri span2">${pm}</div>`),
    F.section('cp-adl1', 'ADLs — MOBILITY & BED MOBILITY',
      `<div class="cp-sub span2">Mobility</div>` + F.checks([['mob_inhome', 'In Home'], ['mob_outhome', 'Out of Home'], ['mob_falls', 'Risk for Falls']])
      + F.text('mob_equipment', 'Equipment', { ph: 'e.g. walker, wheelchair' }) + F.text('mob_prefers', 'Prefers') + F.rs('mob')
      + `<div class="cp-sub span2">Bed mobility</div>` + F.checks([['bed_repos', 'Repositioning'], ['bed_transfer', 'Transfer']])
      + F.text('bed_equipment', 'Equipment/enablers', { ph: 'e.g. gait belt, draw sheet' }) + F.text('bed_enablers', 'Enablers')
      + F.text('bed_prefers', 'Prefers') + F.text('bed_night', 'Nighttime care needs') + F.rs('bed')),
    F.section('cp-adl2', 'ADLs — EATING & TOILETING',
      `<div class="cp-sub span2">Eating</div>` + F.checks([['eat_assist', 'Assistance']])
      + F.text('eat_diet', 'Special diet/supplements') + F.text('eat_enablers', 'Enablers') + F.text('eat_likes', 'Food likes') + F.text('eat_dislikes', 'Food dislikes') + F.rs('eat')
      + `<div class="cp-sub span2">Toileting</div>` + F.checks([['toi_assist', 'Assistance'], ['toi_bladder', 'Bladder Incontinence'], ['toi_bowel', 'Bowel Incontinence']])
      + F.text('toi_equipment', 'Equipment', { ph: 'e.g. pads/briefs' }) + F.text('toi_prefers', 'Prefers') + F.rs('toi')),
    F.section('cp-adl3', 'ADLs — DRESSING, PERSONAL HYGIENE & BATHING',
      `<div class="cp-sub span2">Dressing</div>` + F.checks([['dr_assist', 'Assistance']]) + F.text('dr_prefers', 'Prefers to wear', { span: true }) + F.rs('dr')
      + `<div class="cp-sub span2">Personal hygiene</div>` + F.checks([['hy_assist', 'Assistance']])
      + F.text('hy_dental', 'Dental issues') + F.text('hy_dentures', 'Dentures') + F.text('hy_when', 'When') + F.text('hy_prefers', 'Prefers') + F.rs('hy')
      + `<div class="cp-sub span2">Bathing</div>` + F.checks([['ba_assist', 'Assistance']])
      + F.text('ba_often', 'How often', { ph: 'e.g. 2 x weekly' }) + F.text('ba_when', 'When') + F.text('ba_equipment', 'Equipment') + F.text('ba_prefers', 'Prefers') + F.rs('ba')),
    F.section('cp-adl4', 'BODY CARE (Foot care, skin care, nail care)',
      F.checks([['bc_foot', 'Foot care'], ['bc_diabetes', 'Diabetes / Podiatrist'], ['bc_skin', 'Skin care']]) + F.rs('bc')),
    F.section('cp-misc', 'MISCELLANEOUS, ACTIVITIES & SMOKING',
      `<div class="cp-sub span2">Managing finances</div>` + F.text('fin_who', 'Who manages finances?', { span: true }) + F.rs('fin')
      + `<div class="cp-sub span2">Shopping</div>` + F.text('shop_prefers', 'Prefers', { span: true }) + F.rs('shop')
      + `<div class="cp-sub span2">Transportation</div>` + F.text('tr_special', 'Special transportation needs') + F.text('tr_equipment', 'Equipment')
      + F.text('tr_who', 'Who arranges transportation') + `<div class="field" style="margin:0;align-self:end;">${F.check('tr_accompany', 'Accompany the Resident')}</div>` + F.rs('tr')
      + `<div class="cp-sub span2">Activities / Social</div>` + F.checks([['act_community', 'Community integration']]) + F.rs('act', 'interests & hobbies')
      + `<div class="cp-sub span2">Smoking</div>` + F.checks([['smk_safety', 'Safety concerns']]) + F.rs('smk')
      + F.select('smk_lockeddoor', 'Given option for locked door?', ['Yes', 'No']) + F.text('smk_lockeddoor_why', 'If No, why')
      + F.area('other_notes', 'Other', { rows: 4, ph: 'Everyday-use items, outbreak/mask plan, etc.' })),
    F.section('cp-sign', 'SIGNATURES',
      F.date('orig_plan_date', 'Date of Original Plan', { span: true })
      + `<div class="cp-quad span2">${sigs}</div>`
      + `<div class="cp-static span2">Signatures are collected on the printed copy. Enter names and dates here once signed so the record shows who reviewed the plan.</div>`)
  ].join('');
}

// ══════════════════════════════════
// AD SCHEMA (mirrors the DSHS CARE "Assessment Details" document)
// ══════════════════════════════════
const AD_PERF = ['Independent', 'Supervision', 'Limited Assistance', 'Extensive Assistance', 'Total Dependence', 'Did not occur — no provider', 'Did not occur — client not able', 'Did not occur — client declined'];
const AD_SUPPORT = ['No setup or physical help', 'Setup help only', 'One person physical assist', 'Two+ persons physical assist'];
const AD_STATUS = ['Met', 'Unmet', 'Partially met', 'Client declined'];
const AD_ADLS = [['walk', 'Walk in Room, Hallway & Immediate Living Environment'], ['locin', 'Locomotion in Room & Immediate Living Environment'], ['locout', 'Locomotion Outside of Immediate Living Environment'], ['bed', 'Bed Mobility'], ['transfer', 'Transfer'], ['eating', 'Eating'], ['toilet', 'Toilet Use'], ['dressing', 'Dressing'], ['hygiene', 'Personal Hygiene'], ['bathing', 'Bathing']];
const AD_NAV = [['ad-client', 'Client'], ['ad-goals', 'Goals & Plans'], ['ad-contacts', 'Collateral Contacts'], ['ad-safety', 'Safety & Communication'], ['ad-health', 'Diagnosis & Medications'], ['ad-medical', 'Pain & Health'], ['ad-tx', 'Treatments'], ['ad-cog', 'Sleep, Memory & Behavior'], ['ad-adl', 'ADLs'], ['ad-skin', 'Continence & Skin'], ['ad-iadl', 'IADLs'], ['ad-prov', 'Providers & File']];

function adFormHTML() {
  const cc = [1, 2, 3, 4, 5, 6, 7, 8].map(i => `<div class="cp-quad span2">${F.text(`cc${i}_name`, `Contact ${i}`)}${F.text(`cc${i}_rel`, 'Relationship')}${F.text(`cc${i}_role`, 'Role')}${F.text(`cc${i}_phone`, 'Phone')}</div>`).join('');
  const pain = [1, 2, 3].map(i => F.text(`pain${i}_site`, `Pain site ${i}`) + F.text(`pain${i}_score`, 'Score (0-10)')).join('');
  const tx = [1, 2, 3, 4, 5, 6].map(i => `<div class="cp-quad span2">${F.select(`tx${i}_type`, `Type ${i}`, ['Treatments', 'Programs', 'Skilled Therapies'])}${F.text(`tx${i}_name`, 'Name', { ph: 'e.g. Nebulizer, Vital signs, PT' })}${F.text(`tx${i}_provider`, 'Provider')}${F.text(`tx${i}_freq`, 'Frequency')}</div>${F.text(`tx${i}_notes`, 'Notes', { span: true })}`).join('');
  const bh = [1, 2, 3].map(i => F.text(`bh${i}_name`, `Behavior ${i}`) + F.text(`bh${i}_freq`, 'Frequency') + F.text(`bh${i}_alter`, 'Alterability') + F.text(`bh${i}_desc`, 'Description') + F.area(`bh${i}_interventions`, 'Personalized interventions', { rows: 2, hint: 'one per line' })).join('');
  const adls = AD_ADLS.map(a => `<div class="cp-sub span2">${a[1]}</div>${F.select(a[0] + '_perf', 'Self performance (last 7 days)', AD_PERF)}${F.select(a[0] + '_support', 'Support provided', AD_SUPPORT)}${F.select(a[0] + '_status', 'Status & assistance available', AD_STATUS)}${F.text(a[0] + '_equipment', 'Equipment (type — status)')}${F.area(a[0] + '_instructions', 'Caregiver instructions', { rows: 2 })}`).join('');
  return [
    F.section('ad-client', 'CLIENT INFORMATION & REASON FOR ASSESSMENT',
      F.text('client_name', 'Client Name') + F.text('aces_id', 'Client ACES ID') + F.text('adsa_id', 'Client ADSA ID')
      + F.select('assess_type', 'Assessment type', ['Initial', 'Annual', 'Current Interim', 'Significant Change', 'Other'])
      + F.text('assessor', 'Assessor Name') + F.text('case_manager', 'Current Case Manager') + F.text('office', 'Office', { span: true })
      + F.date('assess_date', 'Assessment Date') + F.date('completed_date', 'Completed Date')
      + F.area('reason', 'Reason For Assessment', { rows: 3 }) + F.select('primary_source', 'Was client the primary source of information?', ['Yes', 'No'])
      + F.text('other_sources', 'Other sources of information')),
    F.section('ad-goals', 'MY GOALS AND PLANS',
      F.area('goal_skills', 'My skills and gifts', { half: true, hint: 'one per line' }) + F.area('goal_relationships', 'My relationships and interests', { half: true })
      + F.area('goal_perfect_day', 'My perfect day', { half: true, rows: 2 }) + F.area('goal_favorites', 'My favorite things / what makes me happy', { half: true, rows: 2 })
      + F.area('goal_important', "What's important to me", { half: true, rows: 2 }) + F.area('goal_live', 'Where I want to live', { half: true, rows: 2 })
      + F.area('goal_next_year', 'In the next year, I really want to', { rows: 2 })
      + F.area('topics', 'Topics of interest', { rows: 3, hint: 'Category / Subcategory / Related to' })
      + F.area('strengths', 'General strength(s)', { half: true }) + F.area('preferences', 'Preference(s)', { half: true })),
    F.section('ad-contacts', 'COLLATERAL CONTACTS', cc),
    F.section('ad-safety', 'SAFETY, FALLS & COMMUNICATION',
      F.area('safety_instructions', 'Caregiver instruction(s) and safety concerns', { rows: 2 })
      + F.select('evac_level', 'AFH Evacuation Level', ['Independent', 'Assistance Required', 'Not Able']) + F.text('falls_6mo', 'Falls in last 6 months')
      + F.area('legal_issues', 'Legal issues', { half: true, rows: 2 }) + F.text('falls_consequences', 'Fall consequence(s)')
      + F.text('comm_expression', 'Modes of expression') + F.text('comm_hearing', 'Hearing') + F.text('comm_vision', 'Ability to see') + F.text('comm_limitations', 'Vision limitations')),
    F.section('ad-health', 'DIAGNOSIS & MEDICATIONS',
      F.area('diagnoses', 'Diagnosis', { rows: 6, hint: 'one per line' }) + F.text('health_indicators', 'Health indicators') + F.select('comatose', 'Is client comatose?', ['No', 'Yes'])
      + F.area('meds', 'Medications', { rows: 6, hint: 'one per line — not to be used as the basis for administration' })
      + F.text('med_routes', 'Routes', { ph: 'e.g. Inhalant, Oral' }) + F.text('med_times_day', 'Max times per day medications are taken')
      + F.select('med_self_admin', 'Self administration', ['Independent', 'Self-directed', 'Assistance', 'Must be administered']) + F.text('med_frequency', 'Frequency of need')
      + F.area('med_limitations', 'Client limitations', { half: true, rows: 2 }) + F.area('med_instructions', 'Caregiver instructions', { half: true, rows: 2 })),
    F.section('ad-medical', 'PAIN, HEALTH INDICATORS & ALLERGIES',
      pain + F.text('pain_frequency', 'Pain frequency') + F.text('pain_management', 'Pain management') + F.text('pain_impact', 'Impact', { span: true })
      + F.text('height', 'Height', { ph: 'e.g. 5 ft 7 in' }) + F.text('weight', 'Weight (lbs)')
      + F.select('wt_loss', 'Weight loss 5%/30d or 10%/180d', ['No', 'Yes']) + F.select('wt_gain', 'Weight gain 5%/30d or 10%/180d', ['No', 'Yes'])
      + F.select('health_rating', 'Self-rated health', ['Excellent', 'Good', 'Fair', 'Poor']) + F.text('last_doc_visit', 'Date of last doctor visit')
      + F.text('hosp_admits', 'Hospital admits (overnight) — last 6 months') + F.text('er_visits', 'ER visits — last 6 months')
      + F.text('doctor', 'Doctor name', { span: true }) + F.area('med_comments', 'Comments', { rows: 3 }) + F.area('allergies', 'Allergies, reactions & immediate care needs', { rows: 2 })),
    F.section('ad-tx', 'TREATMENTS / PROGRAMS / THERAPIES', tx),
    F.section('ad-cog', 'SLEEP, MEMORY, COGNITION & BEHAVIOR',
      F.text('sleep_planning', 'Care planning for sleep') + F.select('sleep_satisfied', 'Satisfied with sleep quality?', ['Yes', 'No']) + F.text('sleep_notes', 'Sleep notes', { span: true })
      + F.text('mem_stm', 'Short-term memory') + F.text('mem_ltm', 'Long-term memory') + F.select('oriented', 'Oriented to person?', ['Yes', 'No'])
      + F.text('cog_expressive', 'Expressive (understood by others)') + F.text('cog_receptive', 'Receptive (understands others)') + F.text('cog_decisions', 'Decision making (last 7 days)')
      + bh + F.select('cbhs_referral', 'CBHS / 1915i referral made?', ['No', 'Yes']) + F.text('cbhs_reason', 'Why / why not') + F.area('depression_notes', 'Depression notes', { rows: 2 })),
    F.section('ad-adl', 'ACTIVITIES OF DAILY LIVING',
      F.text('adl_limitations', 'Functional limitations', { span: true }) + F.text('days_out', 'Days per week out of residence') + F.text('self_sufficiency', 'Self-sufficiency vs. 90 days ago')
      + F.text('potential', 'Potential for improved function') + F.select('task_segmentation', 'Needs task segmentation?', ['No', 'Yes']) + F.select('adjusts_change', 'Adjusts easily to change?', ['Yes', 'No'])
      + adls),
    F.section('ad-skin', 'CONTINENCE, FOOT & SKIN CARE',
      F.text('bladder', 'Bladder control (14 days)') + F.text('bowel', 'Bowel control (14 days)') + F.text('bowel_pattern', 'Bowel pattern') + F.text('cont_appliances', 'Appliances & programs')
      + F.text('cont_management', 'Individual management', { span: true })
      + F.area('foot_issues', 'Foot issues', { half: true, rows: 2 }) + F.area('foot_needs', 'Foot care needs', { half: true, rows: 2 })
      + F.area('skin_problems', 'Skin problems', { half: true, rows: 2 }) + F.area('skin_care', 'Skin care (other than feet)', { half: true, rows: 2 })
      + F.text('pressure_injuries', 'Number of current pressure injuries') + F.text('pressure_points', 'Pressure points', { ph: 'e.g. Skin intact over all pressure points' })
      + F.area('skin_details', 'Skin/foot problem details', { rows: 3 })),
    F.section('ad-iadl', 'IADLs, NUTRITION, COMMUNITY & TOBACCO',
      F.area('meal_instructions', 'Meal preparation — caregiver instructions', { half: true, rows: 2 }) + F.text('diet', 'Diet / texture')
      + F.text('nutrition_problems', 'Nutritional problems') + F.text('oral_problems', 'Oral hygiene & dental problems')
      + F.area('housework', 'Ordinary housework — caregiver instructions', { half: true, rows: 2 }) + F.area('shopping', 'Essential shopping — caregiver instructions', { half: true, rows: 2 })
      + F.area('transport', 'Transportation — caregiver instructions', { rows: 2 })
      + F.select('community_wants', 'Wants to participate in community activities?', ['Yes', 'No']) + F.select('community_assist', 'Needs assistance to participate?', ['Yes', 'No'])
      + F.area('community_details', 'Activities the caregiver will support', { rows: 2 }) + F.area('tobacco', 'Tobacco use (type — status — amount/day)', { rows: 2 })),
    F.section('ad-prov', 'PROVIDER INFORMATION & ORIGINAL DOCUMENT',
      F.area('providers_informal', 'Informal providers & assigned tasks', { half: true, rows: 4 }) + F.area('providers_formal', 'Formal providers & assigned tasks', { half: true, rows: 4 })
      + `<div class="field span2" style="margin:0;"><label>Original DSHS Assessment Details (PDF, max 8 MB)</label>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <input type="file" id="ad-file-input" accept="application/pdf" onchange="adHandleFile(event)" style="font-size:12px;">
            <span id="ad-file-status" class="cp-hint"></span>
            <button type="button" class="btn btn-secondary btn-sm" id="ad-file-clear" style="display:none;" onclick="adClearFile()">Remove file</button>
          </div>
          <input type="hidden" data-k="file_name"><input type="hidden" data-k="file_data">
        </div>`)
  ].join('');
}

// ══════════════════════════════════
// STYLES + MODAL SHELLS (injected once)
// ══════════════════════════════════
function cpInjectOnce() {
  if (document.getElementById('cp-styles')) return;
  const css = document.createElement('style');
  css.id = 'cp-styles';
  css.textContent = `
  .modal.cp-modal { max-width: 1080px; padding: 0; }
  .cp-modal .modal-body { padding: 0 24px 24px; }
  .cp-topbar { position: sticky; top: 0; z-index: 3; background: var(--surface); padding: 14px 0 10px; border-bottom: 1px solid var(--border); margin-bottom: 14px; }
  .cp-nav { display: flex; gap: 6px; overflow-x: auto; padding-top: 10px; scrollbar-width: thin; }
  .cp-nav button { flex: 0 0 auto; border: 1px solid var(--border); background: var(--surface2); color: var(--text2); border-radius: 20px; padding: 4px 11px; font-size: 11.5px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .cp-nav button:hover { border-color: var(--accent); color: var(--accent); }
  .cp-banner { font-size: 12px; color: var(--text2); background: var(--info-light); border: 1px solid var(--info-border); border-radius: 8px; padding: 8px 12px; margin-top: 10px; line-height: 1.5; }
  [data-theme="dark"] .cp-banner { color: var(--text); background: rgba(29,78,216,0.15); }
  .cp-conf { display: inline-flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--danger); background: var(--danger-light); border: 1px solid var(--danger-border); border-radius: 20px; padding: 2px 9px; }
  .cp-section { border: 1px solid var(--border); border-radius: 10px; margin-bottom: 14px; overflow: hidden; scroll-margin-top: 150px; }
  .cp-section-head { background: #d9e2f3; color: #1a2332; font-weight: 700; font-size: 12px; letter-spacing: 0.06em; padding: 8px 14px; display: flex; justify-content: space-between; align-items: center; }
  [data-theme="dark"] .cp-section-head { background: #22324d; color: #e6edf3; }
  .cp-section-head span { font-weight: 500; letter-spacing: 0; font-size: 11px; opacity: 0.75; }
  .cp-grid { padding: 14px; gap: 12px 14px; }
  .cp-grid .field label { font-size: 11.5px; }
  .cp-grid textarea { min-height: 54px; }
  .cp-hint { font-weight: 400; color: var(--text4); font-size: 10.5px; }
  .cp-check { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; color: var(--text); cursor: pointer; padding: 3px 0; }
  .cp-check input { width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; margin: 0; }
  .cp-checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 4px 14px; }
  .cp-radios { display: flex; flex-direction: column; gap: 6px; }
  .cp-radios .cp-check { align-items: flex-start; line-height: 1.45; }
  .cp-radios .cp-check input { margin-top: 2px; }
  .cp-tri { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 12px 14px; }
  .cp-quad { display: grid; grid-template-columns: 2fr 1.2fr 1.2fr 1fr; gap: 12px 14px; align-items: end; }
  .cp-sub { font-size: 11px; font-weight: 700; color: var(--accent); text-transform: uppercase; letter-spacing: 0.07em; border-top: 1px dashed var(--border); padding-top: 10px; margin-top: 2px; }
  .cp-sub:first-child { border-top: none; padding-top: 0; }
  .cp-static { font-size: 12px; color: var(--text3); background: var(--surface2); border-radius: 8px; padding: 8px 12px; }
  .cp-footer { position: sticky; bottom: 0; background: var(--surface); border-top: 1px solid var(--border); padding: 12px 24px; display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; z-index: 3; }
  .cp-card-badges { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  .cp-badge { font-size: 10.5px; font-weight: 700; border-radius: 20px; padding: 2px 9px; border: 1px solid var(--border); color: var(--text2); background: var(--surface2); }
  .cp-badge.ok { color: var(--success); background: var(--success-light); border-color: var(--success-border); }
  .cp-badge.warn { color: var(--warn); background: var(--warn-light); border-color: var(--warn-border); }
  .cp-badge.bad { color: var(--danger); background: var(--danger-light); border-color: var(--danger-border); }
  .cp-due { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; border-radius: 10px; padding: 10px 14px; margin-bottom: 14px; font-size: 13px; border: 1px solid var(--border); background: var(--surface2); }
  @media (max-width: 760px) {
    .cp-tri, .cp-quad { grid-template-columns: 1fr; }
    .cp-modal .modal-body { padding: 0 14px 18px; }
    .cp-footer { padding: 10px 14px; }
  }`;
  document.head.appendChild(css);

  const shell = (id, title, saveFn, bodyId, navId, bannerId, resSelId, onResChange) => `
  <div class="modal-overlay" id="${id}">
    <div class="modal modal-lg cp-modal">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><h3 id="${id}-title">${title}</h3><span class="cp-conf">🔒 Confidential</span></div>
        <button class="btn-close" onclick="cpCloseModal('${id}')"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="cp-topbar">
          <div class="form-grid" style="gap:12px;">
            <div class="field span2" style="margin:0;"><label>Resident *</label><select id="${resSelId}" onchange="${onResChange}(this.value)"></select></div>
          </div>
          <div id="${bannerId}" class="cp-banner" style="display:none;"></div>
          <div class="cp-nav" id="${navId}"></div>
        </div>
        <input type="hidden" id="${id}-edit-id">
        <div id="${bodyId}"></div>
      </div>
      <div class="cp-footer">
        <span class="cp-hint" id="${id}-meta"></span>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary" onclick="cpCloseModal('${id}')">Cancel</button>
          <button class="btn btn-secondary" onclick="${saveFn}(true)">Save &amp; Print</button>
          <button class="btn btn-primary" onclick="${saveFn}(false)">Save</button>
        </div>
      </div>
    </div>
  </div>`;
  const wrap = document.createElement('div');
  wrap.innerHTML = shell('modal-ncp', 'Negotiated Care Plan', 'saveNCP', 'ncp-form', 'ncp-nav', 'ncp-banner', 'ncp-resident', 'ncpResidentChanged')
    + shell('modal-ad', 'Assessment Details', 'saveAD', 'ad-form', 'ad-nav', 'ad-banner', 'ad-resident', 'adResidentChanged');
  while (wrap.firstElementChild) document.body.appendChild(wrap.firstElementChild);

  document.getElementById('ncp-form').innerHTML = ncpFormHTML();
  document.getElementById('ad-form').innerHTML = adFormHTML();
  document.getElementById('ncp-nav').innerHTML = NCP_NAV.map(n => `<button type="button" onclick="document.getElementById('${n[0]}').scrollIntoView({behavior:'smooth',block:'start'})">${n[1]}</button>`).join('');
  document.getElementById('ad-nav').innerHTML = AD_NAV.map(n => `<button type="button" onclick="document.getElementById('${n[0]}').scrollIntoView({behavior:'smooth',block:'start'})">${n[1]}</button>`).join('');
  ['ncp-form', 'ad-form'].forEach(id => document.getElementById(id).addEventListener('input', () => { cpDirty[id] = true; }));
}

const cpDirty = { 'ncp-form': false, 'ad-form': false };
function cpCloseModal(id) {
  const formId = id === 'modal-ncp' ? 'ncp-form' : 'ad-form';
  if (cpDirty[formId] && !confirm('Close without saving? Your changes will be lost.')) return;
  cpDirty[formId] = false;
  closeModal(id);
}

async function cpFillResidentSelect(selId, selectedId) {
  const { data } = await db.from('residents').select('id, name, status').order('name');
  const list = data || [];
  const opt = r => `<option value="${r.id}" ${r.id === selectedId ? 'selected' : ''}>${cpEsc(r.name)}${r.status && r.status !== 'active' ? ' (' + cpEsc(r.status) + ')' : ''}</option>`;
  document.getElementById(selId).innerHTML = '<option value="">— Select Resident —</option>'
    + list.filter(r => r.status === 'active').map(opt).join('')
    + (list.some(r => r.status !== 'active') ? '<optgroup label="Discharged / inactive">' + list.filter(r => r.status !== 'active').map(opt).join('') + '</optgroup>' : '');
}

// ══════════════════════════════════
// SYSTEM DATA FOR AUTO-FILL
// ══════════════════════════════════
async function cpLoadSystem(residentId) {
  const [res, af, meds, vit, ncp, ad] = await Promise.all([
    db.from('residents').select('*').eq('id', residentId).maybeSingle(),
    db.from('resident_admission_forms').select('*').eq('resident_id', residentId).maybeSingle(),
    db.from('medications').select('*').eq('resident_id', residentId),
    db.from('vitals').select('weight, vitals_date').eq('resident_id', residentId).order('vitals_date', { ascending: false }).limit(1),
    db.from('care_plans').select('*').eq('resident_id', residentId).order('plan_date', { ascending: false }).limit(1),
    db.from('assessment_details').select('*').eq('resident_id', residentId).order('assessment_date', { ascending: false }).limit(1)
  ]);
  return {
    r: res.data || {}, af: af.data || {},
    meds: (meds.data || []).filter(m => (m.status || 'active') === 'active'),
    vit: (vit.data || [])[0] || null,
    lastNcp: (ncp.data || [])[0] || null,
    lastAd: (ad.data || [])[0] || null,
    tableMissing: !!(ncp.error || ad.error)
  };
}

function cpContactsFromSystem(r, af) {
  const fam = [];
  const push = (name, rel, phone) => { if (name && fam.length < 3) fam.push({ name, rel, phone }); };
  if (af.primary_contact_name) push(af.primary_contact_name, af.primary_contact_relationship, af.primary_contact_cp || af.primary_contact_home_phone || af.primary_contact_work_phone);
  if (af.secondary_contact_name) push(af.secondary_contact_name, af.secondary_contact_relationship, af.secondary_contact_cp || af.secondary_contact_home_phone || af.secondary_contact_work_phone);
  let physician = af.physician_name ? { name: af.physician_name, phone: af.physician_phone || '', fax: af.physician_fax || '' } : null;
  [r.emergency_contact, r.emergency_contact2, r.emergency_contact3].forEach(s => {
    const c = cpParseContact(s);
    if (!c) return;
    if (c.isPhysician) { if (!physician) physician = { name: c.name, phone: c.phone, fax: '' }; return; }
    if (fam.some(f => f.name && c.name && f.name.toLowerCase().includes(c.name.toLowerCase().split(' ')[0]))) return;
    push(c.name, c.rel, c.phone);
  });
  return { fam, physician };
}

function cpDiagnosesFromSystem(r, af) {
  const src = r.diagnosis || af.diagnoses_history || '';
  return String(src).split(/;|\n/).map(s => s.trim()).filter(Boolean).join('\n');
}

// Pull useful defaults for an NCP out of the latest Assessment Details
function ncpFromAD(a, first) {
  if (!a) return {};
  const d = {};
  const lines = s => cpLines(String(s || '').replace(/,\s*/g, '\n'));
  if (a.diagnoses) d.diagnoses = a.diagnoses;
  if (a.allergies) d.allergies = a.allergies;
  if (/assist|not able/i.test(a.evac_level || '')) d.evac = 'assistance';
  else if (/independent/i.test(a.evac_level || '')) d.evac = 'independent';
  if (a.safety_instructions) d.evac_instructions = a.safety_instructions;
  for (let i = 1; i <= 8; i++) {
    const role = (a[`cc${i}_role`] || '').toLowerCase();
    if (/mental/.test(role) && !d.mh_name) { d.mh_name = a[`cc${i}_name`]; d.mh_phone = a[`cc${i}_phone`]; }
    if (/physician/.test(role) && !d.phys_name) { d.phys_name = a[`cc${i}_name`]; d.phys_phone = a[`cc${i}_phone`]; }
  }
  if (a.comm_hearing && !/adequate|normal/i.test(a.comm_hearing)) d.comm_hearing = true;
  if (a.comm_vision && !/adequate/i.test(a.comm_vision)) d.comm_vision = true;
  if (a.med_self_admin) d.med_level = /independent/i.test(a.med_self_admin) ? 'independent' : 'assistance';
  if (a.med_instructions) d.med_staff = lines(a.med_instructions).join('\n');
  if (a.med_limitations) d.med_resident = `${first}: ${a.med_limitations}`;
  const txNames = [1, 2, 3, 4, 5, 6].map(i => (a[`tx${i}_name`] || '').toLowerCase()).join(' ');
  if (/oxygen|nebul/.test(txNames)) d.tx_oxygen = true;
  if (/therap|program|mental/.test(txNames)) d.tx_programs = true;
  if (/vital/.test(txNames)) d.tx_vitals = true;
  if (a.pain1_site) d.tx_pain = true;
  if (a.wt_loss === 'Yes' || a.wt_gain === 'Yes') d.tx_weight = true;
  if (a.sleep_satisfied === 'No') d.ps_sleep = true;
  if (a.mem_stm && !/ok|intact/i.test(a.mem_stm)) d.ps_stm = true;
  if (a.mem_ltm && !/ok|intact/i.test(a.mem_ltm)) d.ps_ltm = true;
  if (a.depression_notes) d.ps_depression = true;
  const bhStaff = [1, 2, 3].map(i => a[`bh${i}_interventions`]).filter(Boolean).join('\n');
  if (bhStaff) d.ps_staff = bhStaff;
  const bhRes = [1, 2, 3].filter(i => a[`bh${i}_name`]).map(i => `${a[`bh${i}_name`]}${a[`bh${i}_desc`] ? ': ' + a[`bh${i}_desc`] : ''}`).join('\n');
  if (bhRes) d.ps_resident = bhRes;
  const map = { walk: 'mob', locout: 'mob', bed: 'bed', transfer: 'bed', eating: 'eat', toilet: 'toi', dressing: 'dr', hygiene: 'hy', bathing: 'ba' };
  Object.keys(map).forEach(k => {
    const p = map[k];
    if (a[k + '_instructions'] && !d[p + '_staff']) d[p + '_staff'] = lines(a[k + '_instructions']).join('\n');
    else if (a[k + '_instructions']) d[p + '_staff'] += '\n' + lines(a[k + '_instructions']).join('\n');
    if (a[k + '_equipment'] && !d[p + '_equipment']) d[p + '_equipment'] = a[k + '_equipment'];
    if (/assist|depend|supervision/i.test(a[k + '_perf'] || '')) {
      if (p === 'eat') d.eat_assist = true; if (p === 'toi') d.toi_assist = true; if (p === 'dr') d.dr_assist = true; if (p === 'hy') d.hy_assist = true; if (p === 'ba') d.ba_assist = true;
      if (p === 'mob') d.mob_inhome = true; if (p === 'bed') { d.bed_repos = d.bed_repos || k === 'bed'; d.bed_transfer = d.bed_transfer || k === 'transfer'; }
    }
  });
  if (/fall/i.test(a.legal_issues || '') || parseInt(a.falls_6mo) > 0) d.mob_falls = true;
  if (/incontinent/i.test(a.bladder || '')) d.toi_bladder = true;
  if (/incontinent/i.test(a.bowel || '')) d.toi_bowel = true;
  if (a.cont_appliances) d.toi_equipment = a.cont_appliances;
  if (a.diet) d.eat_diet = a.diet;
  if (a.foot_needs || a.foot_issues) d.bc_foot = true;
  if (a.skin_care || a.skin_problems) d.bc_skin = true;
  if (a.transport) d.tr_staff = lines(a.transport).join('\n');
  if (a.shopping) d.shop_staff = lines(a.shopping).join('\n');
  if (a.goal_skills) d.act_resident = `${first} enjoys ${cpLines(a.goal_skills).map(s => s.replace(/^>\s*/, '')).join(', ')}.`;
  if (a.community_wants === 'Yes') d.act_community = true;
  if (a.tobacco) d.smk_resident = a.tobacco;
  return d;
}

function ncpFromSystem(sys) {
  const { r, af } = sys;
  const d = {};
  d.name = r.name || '';
  d.dob = r.dob || '';
  d.date_entered = r.admitted_date || af.admission_date || '';
  d.date_discharged = af.discharge_date || '';
  const { fam, physician } = cpContactsFromSystem(r, af);
  fam.forEach((f, i) => { d[`fam${i + 1}_name`] = f.name; d[`fam${i + 1}_rel`] = f.rel || ''; d[`fam${i + 1}_phone`] = f.phone || ''; d[`fam${i + 1}_emergency`] = true; });
  if (physician) { d.phys_name = physician.name; d.phys_phone = physician.phone; if (physician.fax) d.phys_fax = physician.fax; }
  const dx = cpDiagnosesFromSystem(r, af); if (dx) d.diagnoses = dx;
  if (af.allergies) d.allergies = af.allergies;
  return d;
}

const cpBlank = v => v === undefined || v === null || v === '' || v === false;
function cpMergeFill(target, src) { Object.keys(src || {}).forEach(k => { if (cpBlank(target[k]) && !cpBlank(src[k])) target[k] = src[k]; }); return target; }

// ══════════════════════════════════
// NCP: OPEN / PREFILL / SAVE
// ══════════════════════════════════
async function openAddNCP(residentId, copyFromId) {
  cpInjectOnce();
  const rid = residentId || currentResidentId;
  document.getElementById('modal-ncp-title').textContent = 'New Negotiated Care Plan';
  document.getElementById('modal-ncp-edit-id').value = '';
  document.getElementById('modal-ncp-meta').textContent = '';
  await cpFillResidentSelect('ncp-resident', rid);
  await ncpPrefill(rid, copyFromId);
  openModal('modal-ncp');
  document.querySelector('#modal-ncp .modal').scrollTop = 0;
}

async function ncpResidentChanged(rid) {
  if (cpDirty['ncp-form'] && !confirm('Switch resident? Information typed for the previous resident will be replaced.')) return;
  await ncpPrefill(rid);
}

async function ncpPrefill(rid, copyFromId) {
  const form = document.getElementById('ncp-form');
  const banner = document.getElementById('ncp-banner');
  cpApply(form, {});
  cpDirty['ncp-form'] = false;
  if (!rid) { banner.style.display = 'none'; return; }
  const sys = await cpLoadSystem(rid);
  let base = null, baseLabel = '';
  if (copyFromId) {
    const { data } = await db.from('care_plans').select('*').eq('id', copyFromId).maybeSingle();
    if (data) { base = data; baseLabel = `the care plan dated ${cpFmt(data.plan_date)}`; }
  }
  if (!base && sys.lastNcp) { base = sys.lastNcp; baseLabel = `the previous care plan dated ${cpFmt(base.plan_date)}`; }

  const first = cpFirst(sys.r.name);
  const d = {};
  // 1. Start from the previous plan (monthly NCPs carry forward), minus signatures
  if (base && base.data) {
    Object.assign(d, base.data);
    Object.keys(d).forEach(k => { if (/^sig_/.test(k)) d[k] = ''; });
  }
  // 2. Demographics & contacts always come fresh from the resident profile
  const sysD = ncpFromSystem(sys);
  ['name', 'dob', 'date_entered', 'date_discharged'].forEach(k => { if (sysD[k]) d[k] = sysD[k]; });
  cpMergeFill(d, sysD);
  // 3. Anything still empty: fill from the latest Assessment Details
  cpMergeFill(d, ncpFromAD(sys.lastAd && sys.lastAd.data, first));
  // 4. Sensible defaults
  d.plan_date = cpToday();
  d.orig_plan_date = d.orig_plan_date || (base && base.data && base.data.orig_plan_date) || cpToday();
  if (!d.language) d.language = 'English';
  if (!d.med_away) d.med_away = NCP_DEFAULT_AWAY;
  if (!d.fin_staff) d.fin_staff = '';
  if (!d.sig_provider_name) d.sig_provider_name = cpUser();
  cpApply(form, d);

  const used = ['resident profile'];
  if (Object.keys(sys.af).length) used.push('admission form');
  if (baseLabel) used.push(baseLabel);
  if (sys.lastAd) used.push(`Assessment Details dated ${cpFmt(sys.lastAd.assessment_date)}`);
  banner.innerHTML = sys.tableMissing
    ? '⚠️ The care plan tables are not set up in the database yet. Run <strong>care_plans_setup.sql</strong> in Supabase before saving.'
    : `✨ Pre-filled from: <strong>${used.map(cpEsc).join(', ')}</strong>. Review every section — update anything that has changed since the last plan.`;
  banner.style.display = 'block';
}

async function editNCP(id) {
  cpInjectOnce();
  const { data: p, error } = await db.from('care_plans').select('*').eq('id', id).maybeSingle();
  if (error || !p) { toast('Could not load this care plan'); return; }
  document.getElementById('modal-ncp-title').textContent = 'Edit Negotiated Care Plan';
  document.getElementById('modal-ncp-edit-id').value = id;
  document.getElementById('modal-ncp-meta').textContent = `Created by ${p.created_by || '—'}${p.updated_by ? ' · last edited by ' + p.updated_by : ''}`;
  await cpFillResidentSelect('ncp-resident', p.resident_id);
  cpApply(document.getElementById('ncp-form'), p.data || {});
  cpDirty['ncp-form'] = false;
  const banner = document.getElementById('ncp-banner');
  banner.innerHTML = `Editing the care plan dated <strong>${cpFmt(p.plan_date)}</strong>. To start next month's plan, use <strong>New month from this</strong> instead so this one stays unchanged.`;
  banner.style.display = 'block';
  openModal('modal-ncp');
}

async function saveNCP(andPrint) {
  const rid = document.getElementById('ncp-resident').value;
  const d = cpCollect(document.getElementById('ncp-form'));
  if (!rid) { toast('Please select a resident'); return; }
  if (!d.plan_date) { toast('Please enter the Date of Care Plan'); return; }
  if (!d.name) { toast('Resident name is missing'); return; }
  const editId = document.getElementById('modal-ncp-edit-id').value;
  const now = new Date().toISOString();
  const rec = { resident_id: rid, plan_date: d.plan_date, data: d, updated_at: now, updated_by: cpUser() };
  let res;
  if (editId) res = await db.from('care_plans').update(rec).eq('id', editId).select().maybeSingle();
  else res = await db.from('care_plans').insert(Object.assign({ id: uid(), created_at: now, created_by: cpUser() }, rec)).select().maybeSingle();
  if (res.error) { toast('Error saving care plan: ' + res.error.message); return; }
  cpDirty['ncp-form'] = false;
  closeModal('modal-ncp');
  toast(editId ? 'Care plan updated' : '✅ Care plan saved');
  if (rid === currentResidentId) renderProfileNCPs();
  if (andPrint && res.data) printNCP(res.data.id);
}

async function deleteNCP(id) {
  if (!confirm('Delete this Negotiated Care Plan permanently? This cannot be undone.')) return;
  const { error } = await db.from('care_plans').delete().eq('id', id);
  if (error) { toast('Error: ' + error.message); return; }
  toast('Care plan deleted');
  renderProfileNCPs();
}

// ══════════════════════════════════
// NCP: PROFILE TAB LIST
// ══════════════════════════════════
async function renderProfileNCPs() {
  const box = document.getElementById('profile-ncp-list');
  if (!box) return;
  const { data, error } = await db.from('care_plans').select('id, plan_date, created_by, created_at, updated_by, updated_at, data').eq('resident_id', currentResidentId).order('plan_date', { ascending: false });
  if (error) {
    box.innerHTML = `<div class="cp-due" style="border-color:var(--warn-border);background:var(--warn-light);color:var(--warn);">⚠️ Care plans are not set up in the database yet. Run <strong>care_plans_setup.sql</strong> in the Supabase SQL Editor.</div>`;
    return;
  }
  const list = data || [];
  const today = cpToday();
  let dueHtml = '';
  if (list.length) {
    const next = cpAddMonths(list[0].plan_date, 1);
    const overdue = next < today;
    const soon = !overdue && (Date.parse(next) - Date.parse(today)) / 86400000 <= 7;
    dueHtml = `<div class="cp-due" style="${overdue ? 'border-color:var(--danger-border);background:var(--danger-light);' : ''}">
      <span>${overdue ? '🔴' : soon ? '🟡' : '🟢'} Latest plan: <strong>${cpFmt(list[0].plan_date)}</strong> · Next monthly NCP due <strong>${cpFmt(next)}</strong>${overdue ? ' — <strong style="color:var(--danger);">overdue</strong>' : ''}</span>
      <button class="btn btn-secondary btn-sm" onclick="openAddNCP(currentResidentId, '${list[0].id}')">Start next month's plan</button>
    </div>`;
  }
  if (!list.length) {
    box.innerHTML = `<div class="empty-state">
      <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>
      <h4>No Negotiated Care Plans Yet</h4>
      <p>Click <strong>Add NCP</strong> — the form fills in automatically from this resident's profile, contacts, diagnoses and Assessment Details.</p>
    </div>`;
    return;
  }
  box.innerHTML = dueHtml + list.map((p, i) => {
    const d = p.data || {};
    const evac = d.evac === 'assistance' ? 'Evacuation: Assistance Required' : d.evac === 'independent' ? 'Evacuation: Independent' : '';
    const signed = NCP_SIGS.filter(s => d[`sig_${s[0]}_date`]).length;
    return `<div class="note-card" onclick="printNCP('${p.id}')">
      <div class="note-card-header">
        <div>
          <div class="note-date">Care Plan — ${cpFmt(p.plan_date)} ${i === 0 ? '<span class="cp-badge ok" style="margin-left:6px;">Current</span>' : ''}</div>
          <div class="note-staff">Prepared by ${cpEsc(p.created_by || '—')}${p.updated_by && p.updated_by !== p.created_by ? ' · edited by ' + cpEsc(p.updated_by) : ''}</div>
          <div class="cp-card-badges">
            ${evac ? `<span class="cp-badge ${d.evac === 'assistance' ? 'warn' : ''}">${evac}</span>` : ''}
            <span class="cp-badge ${signed ? 'ok' : 'bad'}">${signed ? signed + ' of 4 signatures recorded' : 'Signatures not recorded'}</span>
          </div>
        </div>
        <div class="note-actions" onclick="event.stopPropagation()" style="flex-wrap:wrap;justify-content:flex-end;">
          <button class="btn btn-secondary btn-sm" onclick="printNCP('${p.id}')">🖨️ View / Print</button>
          <button class="btn btn-secondary btn-sm" onclick="openAddNCP(currentResidentId, '${p.id}')">New month from this</button>
          <button class="btn btn-secondary btn-sm" onclick="editNCP('${p.id}')">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteNCP('${p.id}')">Delete</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════
// NCP: PRINT (layout follows the Harmony NCP form)
// ══════════════════════════════════
function cpBox(v) { return v ? '☒' : '☐'; }
function cpPara(v) { return cpLines(v).map(l => `<div>${cpEsc(l)}</div>`).join('') || '&nbsp;'; }
function cpBullets(v, lead) {
  const ls = cpLines(v).map(l => l.replace(/^[-•*]\s*/, ''));
  return `<div class="lead">${lead || 'Staff will:'}</div>${ls.length ? `<ul>${ls.map(l => `<li>${cpEsc(l)}</li>`).join('')}</ul>` : '<ul><li>&nbsp;</li></ul>'}`;
}
function cpPrintWindow(html, title) {
  const win = window.open('', '_blank', 'width=1000,height=1200');
  if (!win) { toast('Please allow pop-ups to print'); return; }
  win.document.write(html);
  win.document.close();
  win.document.title = title;
  win.focus();
  setTimeout(() => { win.print(); }, 600);
}
const CP_PRINT_CSS = `
  @page { size: letter; margin: 0.5in 0.45in 0.6in; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color: #000; margin: 0; }
  .doc-head { display: flex; align-items: center; justify-content: center; gap: 14px; margin-bottom: 4px; }
  .doc-head img { width: 64px; height: 64px; object-fit: contain; }
  .doc-head .titles { text-align: center; }
  h1 { text-align: center; font-size: 13pt; margin: 0 0 2px; letter-spacing: 0.02em; }
  h2 { text-align: center; font-size: 12pt; margin: 0 0 10px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; page-break-inside: auto; border: 2px double #000; }
  tr { page-break-inside: avoid; }
  td, th { border: 1px solid #000; padding: 3px 6px; vertical-align: top; text-align: left; }
  th, .hd { background: #d9e2f3; font-weight: bold; text-align: center; }
  .lbl { font-weight: bold; }
  .c { text-align: center; } .box { text-align: center; font-size: 13pt; width: 46px; }
  .allergy { color: #c00000; }
  ul { margin: 0; padding-left: 18px; } li { margin: 0; }
  .lead { font-weight: bold; }
  .small { font-size: 8.5pt; }
  .conf { text-align: center; font-size: 8pt; color: #555; margin: -6px 0 8px; }
  .meta { text-align: right; font-size: 8pt; color: #555; margin-bottom: 4px; }
`;

function ncpPrintHTML(p, residentName) {
  const d = p.data || {};
  const first = cpFirst(d.name || residentName);
  const rsRow = (label, items, prefix, extra) => `
    <tr><th style="width:24%;text-align:left;">${label}</th><th style="width:6%;">YES</th><th style="width:32%;">RESIDENT</th><th style="width:38%;">STAFF</th></tr>
    ${items.map((it, i) => `<tr><td class="lbl">${it[1]}${it[2] ? ' ' + cpEsc(d[it[2]] || '') : ''}</td><td class="box">${it[0] ? cpBox(d[it[0]]) : ''}</td>${i === 0 ? `<td rowspan="${items.length + (extra ? extra.length : 0)}">${cpPara(d[prefix + '_resident'])}</td><td rowspan="${items.length + (extra ? extra.length : 0)}">${cpBullets(d[prefix + '_staff'])}</td>` : ''}</tr>`).join('')}
    ${(extra || []).map(e => `<tr><td class="lbl" colspan="2">${e[0]} <span style="font-weight:normal;">${cpEsc(d[e[1]] || '')}</span></td></tr>`).join('')}`;
  const adlTable = (title, items, prefix, extra) => `<table>${rsRow(title, items, prefix, extra).replace('<th style="width:6%;">YES</th>', '<th style="width:6%;"></th>')}</table>`;

  const fam = [1, 2, 3].map(i => `<tr><td colspan="2"><span class="lbl">Family/Friend</span><br>${cpEsc(d[`fam${i}_name`] || '')}${d[`fam${i}_rel`] ? ' (' + cpEsc(d[`fam${i}_rel`]) + ')' : ''}</td><td colspan="2">${d[`fam${i}_emergency`] ? 'Emergency Contact' : ''}</td><td><span class="lbl">Phone</span><br>${cpEsc(d[`fam${i}_phone`] || '')}</td></tr>`).join('');
  const dx = cpLines(d.diagnoses);
  const half = Math.ceil(dx.length / 2);
  const dxCol = (arr, start) => `<ol start="${start}" style="margin:0;padding-left:22px;">${arr.map(x => `<li>${cpEsc(x)}</li>`).join('')}</ol>`;
  const pmRows = [1, 2, 3, 4].map(i => `<tr><td>${cpEsc(d[`pm${i}_med`] || '')}&nbsp;</td><td>${cpEsc(d[`pm${i}_purpose`] || '')}</td><td>${cpEsc(d[`pm${i}_side`] || '')}</td></tr>`).join('');
  const nd = NCP_ND.map(n => `${cpBox(d[n[0]])} ${n[1]}`);
  const sigRows = NCP_SIGS.map(s => `<tr><td class="lbl">${s[1]}</td><td>${cpEsc(d[`sig_${s[0]}_name`] || '')}</td><td>${cpFmt(d[`sig_${s[0]}_date`])}</td><td>${cpFmt(d[`sig_${s[0]}_rev1`])}</td><td>${cpFmt(d[`sig_${s[0]}_rev2`])}</td></tr>`).join('')
    + [1, 2, 3, 4].map(() => '<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>').join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>NCP — ${cpEsc(d.name || residentName)} — ${cpFmt(p.plan_date)}</title><style>${CP_PRINT_CSS}</style></head><body>
  <div class="doc-head"><img src="${cpLogoUrl()}" alt="" onerror="this.style.display='none'"><div class="titles"><h1>${CP_FACILITY}</h1><h2 style="margin-bottom:0;">NEGOTIATED CARE PLAN</h2></div></div>
  <div class="conf" style="margin-top:2px;">CONFIDENTIAL — Resident health information. Do not copy or share without authorization.</div>

  <table>
    <tr><td colspan="5" class="hd">DEMOGRAPHICS</td></tr>
    <tr><td class="c" style="width:30%;"><span class="lbl">Name</span><br>${cpEsc(d.name)}</td><td class="c" style="width:18%;"><span class="lbl">Date Entered</span><br>${cpFmt(d.date_entered)}</td><td class="c" colspan="2"><span class="lbl">Date of Care Plan</span><br>${cpFmt(d.plan_date)}</td><td class="c" style="width:24%;"><span class="lbl">Date Discharged</span><br>${cpFmt(d.date_discharged)}</td></tr>
    <tr><td class="c"><span class="lbl">Date of Birth</span><br>${cpFmt(d.dob)}</td><td></td><td class="c" colspan="3"><span class="lbl">Primary Language</span><br>${cpEsc(d.language)}</td></tr>
    <tr><td colspan="5" class="hd">CONTACTS</td></tr>
    ${fam}
    <tr><td colspan="2"><span class="lbl">Mental Health Provider</span><br>${cpEsc(d.mh_name || '')}</td><td colspan="2">Mental Health Provider</td><td><span class="lbl">Phone</span><br>${cpEsc(d.mh_phone || '')}</td></tr>
    <tr><td colspan="3"><span class="lbl">Physician or Medical Group</span><br>${cpEsc(d.phys_name || '')}</td><td><span class="lbl">Phone</span><br>${cpEsc(d.phys_phone || '')}</td><td><span class="lbl">Fax</span><br>${cpEsc(d.phys_fax || '')}</td></tr>
    <tr><td colspan="3"><span class="lbl">Pharmacy</span><br>${cpEsc(d.pharm_name || '')}</td><td><span class="lbl">Phone</span><br>${cpEsc(d.pharm_phone || '')}</td><td><span class="lbl">Fax</span><br>${cpEsc(d.pharm_fax || '')}</td></tr>
    <tr><td colspan="5" class="hd">Specialty Needs:</td></tr>
    <tr><td class="lbl">Dementia</td><td class="box">${cpBox(d.sn_dementia)}</td><td colspan="3">${cpEsc(d.sn_dementia_note || '')}</td></tr>
    <tr><td class="lbl">Mental Health</td><td class="box">${cpBox(d.sn_mh)}</td><td colspan="3">${cpEsc(d.sn_mh_note || '')}</td></tr>
    <tr><td class="lbl">Developmental Disability</td><td class="box">${cpBox(d.sn_dd)}</td><td colspan="3">${cpEsc(d.sn_dd_note || '')}</td></tr>
    <tr><td colspan="4" class="hd">Emergency Evacuation:</td><td class="hd">Yes</td></tr>
    <tr><td class="lbl">Independent</td><td colspan="3">Physically &amp; mentally capable of safely getting out of the home without the assistance of another individual or the use of mobility aids, AND with one verbal cue.</td><td class="box">${cpBox(d.evac === 'independent')}</td></tr>
    <tr><td class="lbl">Assistance Required</td><td colspan="3">Not physically or mentally capable of getting out of the house without assistance from another individual or mobility aids.</td><td class="box">${cpBox(d.evac === 'assistance')}</td></tr>
    <tr><td colspan="5"><span class="lbl">Special Instructions:</span> ${cpEsc(d.evac_instructions || '')}</td></tr>
  </table>

  <table>
    <tr><td colspan="2" class="hd">CURRENT MEDICAL STATUS</td></tr>
    <tr><td colspan="2">${cpPara(d.medical_status)}</td></tr>
    <tr><td colspan="2" class="hd">MEDICAL HISTORY/DIAGNOSIS</td></tr>
    <tr><td style="width:50%;">${dxCol(dx.slice(0, half), 1)}</td><td>${dxCol(dx.slice(half), half + 1)}</td></tr>
    <tr><td colspan="2" class="allergy">ALLERGIES: ${cpEsc(d.allergies || 'None known')}</td></tr>
  </table>

  <table>
    <tr><th style="width:24%;text-align:left;">COMMUNICATION</th><th style="width:6%;">YES</th><th style="width:32%;">RESIDENT</th><th style="width:38%;">STAFF</th></tr>
    <tr><td class="lbl">PROBLEMS WITH SPEECH</td><td class="box">${cpBox(d.comm_speech)}</td><td rowspan="3">${cpPara(d.comm_resident)}</td><td rowspan="4">${cpBullets(d.comm_staff)}</td></tr>
    <tr><td class="lbl">HEARING PROBLEMS</td><td class="box">${cpBox(d.comm_hearing)}</td></tr>
    <tr><td class="lbl">VISION PROBLEMS</td><td class="box">${cpBox(d.comm_vision)}</td></tr>
    <tr><td colspan="3" class="lbl">TELEPHONE USE: ${cpEsc(d.comm_phone || '')}</td></tr>
  </table>

  <table>
    <tr><td colspan="4" class="hd">MEDICATION MANAGEMENT</td></tr>
    <tr><th colspan="2"></th><th style="width:32%;">RESIDENT</th><th style="width:38%;">STAFF</th></tr>
    <tr><td class="lbl" style="width:18%;">INDEPENDENT</td><td class="box" style="width:12%;">${cpBox(d.med_level === 'independent')}</td><td>${d.med_level === 'independent' ? cpPara(d.med_resident) : ''}</td><td>${d.med_level === 'independent' ? cpBullets(d.med_staff) : cpBullets('')}</td></tr>
    <tr><td class="lbl">ASSISTANCE</td><td class="box">${cpBox(d.med_level === 'assistance')}</td><td>${d.med_level !== 'independent' ? cpPara(d.med_resident) : ''}</td><td>${d.med_level !== 'independent' ? cpBullets(d.med_staff) : cpBullets('')}</td></tr>
    <tr><td class="lbl">NURSE DELEGATION</td><td class="small">${nd.slice(0, 5).join('<br>')}<br>${cpBox(d.nd_other)} Other: ${cpEsc(d.nd_other || '')}</td><td class="small">${nd.slice(5).join('<br>')}</td><td>${cpBullets(d.nd_staff, 'Delegated Staff will:')}</td></tr>
    <tr><td colspan="4"><span class="lbl">Medication plans when the resident is not in the home:</span> ${cpEsc(d.med_away || '')}</td></tr>
  </table>
  <table><tr><td class="small"><strong>WAC 388-76-10435: Plan for Medication refusal</strong><ul>${NCP_MED_REFUSAL.map(x => `<li>${x}</li>`).join('')}</ul><br><strong>NOTE:</strong> ${NCP_MED_REFUSAL_NOTE}</td></tr></table>

  <table>
    <tr><td colspan="4" class="hd">TREATMENT/PROGRAMS/THERAPIES</td></tr>
    ${rsRow('', NCP_TX.map(t => [t[0], t[1].toUpperCase()]), 'tx')}
  </table>

  <table>
    <tr><td colspan="4" class="hd">PSYCH/SOCIAL/COGNITIVE STATUS</td></tr>
    ${rsRow('', NCP_PSYCH, 'ps')}
  </table>
  <table>
    <tr><td colspan="3" class="hd">PSYCHOPHARMICALOGICAL MEDICATIONS</td></tr>
    <tr><th style="width:30%;">Medication</th><th style="width:30%;">Purpose</th><th>Side effects</th></tr>
    ${pmRows}
    <tr><td colspan="3">${NCP_PSYCH_FOOTER}</td></tr>
  </table>

  <table><tr><td class="hd">UNIVERSAL PRECAUTIONS</td></tr><tr><td>${NCP_UNIVERSAL}</td></tr></table>

  <table><tr><td class="hd">ADLs</td></tr></table>
  ${adlTable('MOBILITY', [['mob_inhome', 'In Home'], ['mob_outhome', 'Out of Home'], ['mob_falls', 'Risk for Falls']], 'mob', [['Equipment:', 'mob_equipment'], ['Prefers:', 'mob_prefers']])}
  ${adlTable('BED MOBILITY', [['bed_repos', 'Repositioning'], ['bed_transfer', 'Transfer']], 'bed', [['Equipment/enablers:', 'bed_equipment'], ['Enablers:', 'bed_enablers'], ['Prefers:', 'bed_prefers'], ['Nighttime care needs:', 'bed_night']])}
  ${adlTable('EATING', [['eat_assist', 'Assistance']], 'eat', [['Special diet/supplements:', 'eat_diet'], ['Food likes:', 'eat_likes'], ['Food dislikes:', 'eat_dislikes'], ['Enablers:', 'eat_enablers']])}
  ${adlTable('TOILETING', [['toi_assist', 'Assistance'], ['toi_bladder', 'Bladder Incontinence'], ['toi_bowel', 'Bowel Incontinence']], 'toi', [['Equipment:', 'toi_equipment'], ['Prefers:', 'toi_prefers']])}
  ${adlTable('DRESSING', [['dr_assist', 'Assistance']], 'dr', [['Prefers to wear:', 'dr_prefers']])}
  ${adlTable('PERSONAL HYGIENE', [['hy_assist', 'Assistance']], 'hy', [['Dental issues:', 'hy_dental'], ['Dentures:', 'hy_dentures'], ['When:', 'hy_when'], ['Prefers:', 'hy_prefers']])}
  ${adlTable('BATHING', [['ba_assist', 'Assistance']], 'ba', [['How often:', 'ba_often'], ['When:', 'ba_when'], ['Equipment:', 'ba_equipment'], ['Prefers:', 'ba_prefers']])}
  ${adlTable('BODY CARE (Foot care, skin care, nail care)', [['bc_foot', 'Foot care'], ['bc_diabetes', 'Diabetes / Podiatrist'], ['bc_skin', 'Skin care']], 'bc')}
  ${adlTable('MISCELLANEOUS', [['', 'Managing finances']], 'fin', [['Who manages finances?', 'fin_who']])}
  ${adlTable('SHOPPING', [['', 'Prefers: ' + cpEsc(d.shop_prefers || '')]], 'shop')}
  ${adlTable('TRANSPORTATION', [['tr_accompany', 'Accompany the Resident']], 'tr', [['Special transportation needs:', 'tr_special'], ['Equipment:', 'tr_equipment'], ['Who arranges transportation:', 'tr_who']])}
  ${adlTable('ACTIVITIES/SOCIAL', [['act_community', 'Community integration']], 'act')}
  ${adlTable('SMOKING', [['smk_safety', 'Safety concerns']], 'smk')}
  <table>
    <tr><td class="lbl" style="width:40%;">GIVEN OPTION FOR LOCKED DOOR?</td><td>${cpEsc(d.smk_lockeddoor || '')}</td></tr>
    <tr><td class="lbl">If No, why</td><td>${cpEsc(d.smk_lockeddoor_why || '')}</td></tr>
    <tr><td class="lbl">Other</td><td>${cpPara(d.other_notes)}</td></tr>
  </table>

  <table>
    <tr><td colspan="5" class="lbl">DATE OF ORIGINAL PLAN: ${cpFmt(d.orig_plan_date)}</td></tr>
    <tr><th style="width:24%;">TITLE</th><th>SIGNATURE</th><th style="width:14%;">DATE</th><th style="width:14%;">REVIEW DATE</th><th style="width:14%;">REVIEW DATE</th></tr>
    ${sigRows}
  </table>
  <div class="conf" style="margin-top:6px;">CONFIDENTIAL — ${cpEsc(d.name || residentName)} · Negotiated Care Plan ${cpFmt(p.plan_date)}</div>
  <div class="meta">Prepared by ${cpEsc(p.created_by || '')}${p.updated_by ? ' · last edited by ' + cpEsc(p.updated_by) : ''} · Printed ${cpFmt(cpToday())}</div>
  </body></html>`;
}

async function printNCP(id) {
  const { data: p } = await db.from('care_plans').select('*').eq('id', id).maybeSingle();
  if (!p) { toast('Care plan not found'); return; }
  cpPrintWindow(ncpPrintHTML(p, ''), `NCP ${cpFmt(p.plan_date)}`);
}

// ══════════════════════════════════
// ASSESSMENT DETAILS: OPEN / PREFILL / SAVE
// ══════════════════════════════════
async function openAddAD(residentId) {
  cpInjectOnce();
  const rid = residentId || currentResidentId;
  document.getElementById('modal-ad-title').textContent = 'Record Assessment Details';
  document.getElementById('modal-ad-edit-id').value = '';
  document.getElementById('modal-ad-meta').textContent = '';
  await cpFillResidentSelect('ad-resident', rid);
  await adPrefill(rid);
  openModal('modal-ad');
}
async function adResidentChanged(rid) {
  if (cpDirty['ad-form'] && !confirm('Switch resident? Information typed for the previous resident will be replaced.')) return;
  await adPrefill(rid);
}
async function adPrefill(rid) {
  const form = document.getElementById('ad-form');
  const banner = document.getElementById('ad-banner');
  cpApply(form, {});
  adShowFile();
  cpDirty['ad-form'] = false;
  if (!rid) { banner.style.display = 'none'; return; }
  const sys = await cpLoadSystem(rid);
  const { r, af } = sys;
  const d = {};
  if (sys.lastAd && sys.lastAd.data) {
    Object.assign(d, sys.lastAd.data);
    ['assess_date', 'completed_date', 'reason', 'file_name', 'file_data', 'assess_type'].forEach(k => d[k] = '');
  }
  const nameParts = String(r.name || '').trim().split(/\s+/);
  d.client_name = nameParts.length > 1 ? `${nameParts[nameParts.length - 1]}, ${nameParts.slice(0, -1).join(' ')}` : (r.name || '');
  const { fam, physician } = cpContactsFromSystem(r, af);
  const sysContacts = fam.map(f => ({ name: f.name, rel: f.rel, role: 'Emergency Contact', phone: f.phone }));
  if (physician) sysContacts.push({ name: physician.name, rel: 'Not related', role: 'Primary physician', phone: physician.phone });
  sysContacts.forEach(c => {
    for (let i = 1; i <= 8; i++) {
      const existing = (d[`cc${i}_name`] || '').toLowerCase();
      if (existing && c.name && existing.includes(c.name.toLowerCase().split(' ')[0])) return;
    }
    for (let i = 1; i <= 8; i++) if (!d[`cc${i}_name`]) { d[`cc${i}_name`] = c.name; d[`cc${i}_rel`] = c.rel || ''; d[`cc${i}_role`] = c.role; d[`cc${i}_phone`] = c.phone || ''; return; }
  });
  const dx = cpDiagnosesFromSystem(r, af); if (dx && !d.diagnoses) d.diagnoses = dx;
  if (af.allergies && !d.allergies) d.allergies = af.allergies;
  if (sys.meds.length) d.meds = sys.meds.map(m => [m.name, m.dosage, m.frequency].filter(Boolean).join(' — ')).join('\n');
  if (af.height && !d.height) d.height = af.height;
  if (sys.vit && sys.vit.weight) d.weight = sys.vit.weight; else if (af.weight && !d.weight) d.weight = af.weight;
  if (physician && !d.doctor) d.doctor = physician.name;
  if (!d.providers_formal) d.providers_formal = 'Harmony Living House Adult Family LLC';
  d.assess_date = cpToday();
  cpApply(form, d);
  const used = ['resident profile'];
  if (Object.keys(af).length) used.push('admission form');
  if (sys.meds.length) used.push(`${sys.meds.length} active medication${sys.meds.length > 1 ? 's' : ''}`);
  if (sys.vit && sys.vit.weight) used.push('latest vitals');
  if (sys.lastAd) used.push(`previous Assessment Details dated ${cpFmt(sys.lastAd.assessment_date)}`);
  banner.innerHTML = sys.tableMissing
    ? '⚠️ The assessment tables are not set up in the database yet. Run <strong>care_plans_setup.sql</strong> in Supabase before saving.'
    : `✨ Pre-filled from: <strong>${used.map(cpEsc).join(', ')}</strong>. Copy the remaining answers from the DSHS Assessment Details you received, and attach the original PDF at the bottom.`;
  banner.style.display = 'block';
}

async function editAD(id) {
  cpInjectOnce();
  const { data: a, error } = await db.from('assessment_details').select('*').eq('id', id).maybeSingle();
  if (error || !a) { toast('Could not load these Assessment Details'); return; }
  document.getElementById('modal-ad-title').textContent = 'Edit Assessment Details';
  document.getElementById('modal-ad-edit-id').value = id;
  document.getElementById('modal-ad-meta').textContent = `Recorded by ${a.created_by || '—'}${a.updated_by ? ' · last edited by ' + a.updated_by : ''}`;
  await cpFillResidentSelect('ad-resident', a.resident_id);
  cpApply(document.getElementById('ad-form'), a.data || {});
  adShowFile();
  cpDirty['ad-form'] = false;
  const banner = document.getElementById('ad-banner');
  banner.innerHTML = `Editing Assessment Details dated <strong>${cpFmt(a.assessment_date)}</strong>.`;
  banner.style.display = 'block';
  openModal('modal-ad');
}

function adHandleFile(e) {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  if (f.type !== 'application/pdf') { toast('Please choose a PDF file'); e.target.value = ''; return; }
  if (f.size > 8 * 1024 * 1024) { toast('PDF is larger than 8 MB'); e.target.value = ''; return; }
  const reader = new FileReader();
  reader.onload = ev => {
    document.querySelector('#ad-form [data-k="file_data"]').value = ev.target.result;
    document.querySelector('#ad-form [data-k="file_name"]').value = f.name;
    cpDirty['ad-form'] = true;
    adShowFile();
  };
  reader.readAsDataURL(f);
}
function adClearFile() {
  document.querySelector('#ad-form [data-k="file_data"]').value = '';
  document.querySelector('#ad-form [data-k="file_name"]').value = '';
  const inp = document.getElementById('ad-file-input'); if (inp) inp.value = '';
  cpDirty['ad-form'] = true;
  adShowFile();
}
function adShowFile() {
  const nameEl = document.querySelector('#ad-form [data-k="file_name"]');
  const st = document.getElementById('ad-file-status');
  const clr = document.getElementById('ad-file-clear');
  if (!nameEl || !st) return;
  st.textContent = nameEl.value ? '📎 ' + nameEl.value : 'No file attached';
  clr.style.display = nameEl.value ? 'inline-flex' : 'none';
}

async function saveAD(andPrint) {
  const rid = document.getElementById('ad-resident').value;
  const d = cpCollect(document.getElementById('ad-form'));
  if (!rid) { toast('Please select a resident'); return; }
  if (!d.assess_date) { toast('Please enter the Assessment Date'); return; }
  const editId = document.getElementById('modal-ad-edit-id').value;
  const now = new Date().toISOString();
  const rec = { resident_id: rid, assessment_date: d.assess_date, data: d, updated_at: now, updated_by: cpUser() };
  let res;
  if (editId) res = await db.from('assessment_details').update(rec).eq('id', editId).select('id').maybeSingle();
  else res = await db.from('assessment_details').insert(Object.assign({ id: uid(), created_at: now, created_by: cpUser() }, rec)).select('id').maybeSingle();
  if (res.error) { toast('Error saving: ' + res.error.message); return; }
  cpDirty['ad-form'] = false;
  closeModal('modal-ad');
  toast(editId ? 'Assessment Details updated' : '✅ Assessment Details saved');
  if (rid === currentResidentId) renderProfileADs();
  if (andPrint && res.data) printAD(res.data.id);
}

async function deleteAD(id) {
  if (!confirm('Delete these Assessment Details permanently (including the attached PDF)? This cannot be undone.')) return;
  const { error } = await db.from('assessment_details').delete().eq('id', id);
  if (error) { toast('Error: ' + error.message); return; }
  toast('Assessment Details deleted');
  renderProfileADs();
}

async function openADFile(id) {
  const { data: a } = await db.from('assessment_details').select('data').eq('id', id).maybeSingle();
  const url = a && a.data && a.data.file_data;
  if (!url) { toast('No PDF attached'); return; }
  const bytes = atob(url.split(',')[1] || '');
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blobUrl = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
  window.open(blobUrl, '_blank');
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
}

async function renderProfileADs() {
  const box = document.getElementById('profile-ad-list');
  if (!box) return;
  const { data, error } = await db.from('assessment_details').select('id, assessment_date, created_by, updated_by, data').eq('resident_id', currentResidentId).order('assessment_date', { ascending: false });
  if (error) {
    box.innerHTML = `<div class="cp-due" style="border-color:var(--warn-border);background:var(--warn-light);color:var(--warn);">⚠️ Assessment Details are not set up in the database yet. Run <strong>care_plans_setup.sql</strong> in the Supabase SQL Editor.</div>`;
    return;
  }
  const list = data || [];
  if (!list.length) {
    box.innerHTML = `<div class="empty-state">
      <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>
      <h4>No Assessment Details On File</h4>
      <p>When the case manager sends the DSHS Assessment Details, record them here and attach the PDF. New care plans will pull from the latest one.</p>
    </div>`;
    return;
  }
  box.innerHTML = list.map((a, i) => {
    const d = a.data || {};
    return `<div class="note-card" onclick="printAD('${a.id}')">
      <div class="note-card-header">
        <div>
          <div class="note-date">${cpEsc(d.assess_type || 'Assessment')} — ${cpFmt(a.assessment_date)} ${i === 0 ? '<span class="cp-badge ok" style="margin-left:6px;">Latest</span>' : ''}</div>
          <div class="note-staff">Case Manager: ${cpEsc(d.case_manager || '—')}${d.office ? ' · ' + cpEsc(d.office) : ''} · Recorded by ${cpEsc(a.created_by || '—')}</div>
          <div class="cp-card-badges">
            ${d.evac_level ? `<span class="cp-badge ${/assist/i.test(d.evac_level) ? 'warn' : ''}">Evacuation: ${cpEsc(d.evac_level)}</span>` : ''}
            <span class="cp-badge ${d.file_name ? 'ok' : 'bad'}">${d.file_name ? '📎 Original PDF attached' : 'No PDF attached'}</span>
          </div>
        </div>
        <div class="note-actions" onclick="event.stopPropagation()" style="flex-wrap:wrap;justify-content:flex-end;">
          ${d.file_name ? `<button class="btn btn-secondary btn-sm" onclick="openADFile('${a.id}')">📎 Open PDF</button>` : ''}
          <button class="btn btn-secondary btn-sm" onclick="printAD('${a.id}')">🖨️ View / Print</button>
          <button class="btn btn-secondary btn-sm" onclick="editAD('${a.id}')">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteAD('${a.id}')">Delete</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════
// AD: PRINT — facility summary in the same section order as the DSHS document
// (Harmony-branded; the official record is the attached original)
// ══════════════════════════════════
function adPrintHTML(a) {
  const d = a.data || {};
  const kv = (label, v) => v ? `<div class="kv"><b>${label}:</b> ${cpEsc(v)}</div>` : '';
  const list = (label, v) => cpLines(v).length ? `<div class="kv"><b>${label}:</b>${cpLines(v).map(l => `<div class="ind">&gt; ${cpEsc(l.replace(/^>\s*/, ''))}</div>`).join('')}</div>` : '';
  const sec = (title, body) => body.trim() ? `<div class="sec">${title}</div><div class="body">${body}</div>` : '';
  const ccRows = [1, 2, 3, 4, 5, 6, 7, 8].filter(i => d[`cc${i}_name`]).map(i => `<tr><td>${cpEsc(d[`cc${i}_name`])}</td><td>${cpEsc(d[`cc${i}_rel`] || '')}</td><td>${cpEsc(d[`cc${i}_role`] || '')}</td><td>${cpEsc(d[`cc${i}_phone`] || '')}</td></tr>`).join('');
  const painRows = [1, 2, 3].filter(i => d[`pain${i}_site`]).map(i => `<tr><td>${cpEsc(d[`pain${i}_site`])}</td><td>${cpEsc(d[`pain${i}_score`] || '')}</td></tr>`).join('');
  const txRows = [1, 2, 3, 4, 5, 6].filter(i => d[`tx${i}_name`]).map(i => `<tr><td>${cpEsc(d[`tx${i}_type`] || '')}</td><td>${cpEsc(d[`tx${i}_name`])}</td><td>${cpEsc(d[`tx${i}_provider`] || '')}</td><td>${cpEsc(d[`tx${i}_freq`] || '')}</td><td>${cpEsc(d[`tx${i}_notes`] || '')}</td></tr>`).join('');
  const bh = [1, 2, 3].filter(i => d[`bh${i}_name`]).map(i => `<div class="kv"><b>Name:</b> ${cpEsc(d[`bh${i}_name`])}</div>${kv('Behavior description', d[`bh${i}_desc`])}${kv('Frequency', d[`bh${i}_freq`])}${kv('Alterability', d[`bh${i}_alter`])}${list('Personalized interventions', d[`bh${i}_interventions`])}`).join('<hr>');
  const adls = AD_ADLS.filter(x => d[x[0] + '_perf'] || d[x[0] + '_instructions']).map(x => `<div class="sub">${x[1]}</div>
    ${kv('Self Performance and Support Provided in the last 7 days', [d[x[0] + '_perf'], d[x[0] + '_support']].filter(Boolean).join(', '))}
    ${kv('Status and Assistance Available', d[x[0] + '_status'])}${kv('Caregiver Instructions', d[x[0] + '_instructions'])}${kv('Equipment', d[x[0] + '_equipment'])}`).join('');
  let bmi = '';
  const hM = String(d.height || '').match(/(\d+)\D+(\d+)/), w = parseFloat(d.weight);
  if (hM && w) { const inches = +hM[1] * 12 + +hM[2]; bmi = (703 * w / (inches * inches)).toFixed(1); }
  const name = d.client_name || '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Assessment Details — ${cpEsc(name)} — ${cpFmt(a.assessment_date)}</title><style>
    @page { size: letter; margin: 0.55in 0.6in 0.7in; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color: #000; margin: 0; }
    .top { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 10px; }
    .top h1 { font-size: 17pt; margin: 0; } .top .sub2 { font-size: 10pt; color: #333; }
    .sec { background: #d0d0d0; font-weight: bold; font-size: 12pt; padding: 5px 8px; margin: 14px 0 6px; page-break-after: avoid; }
    .sub { font-weight: bold; margin: 10px 0 3px; font-size: 11pt; page-break-after: avoid; }
    .body { padding: 0 8px; } .kv { margin: 3px 0; line-height: 1.4; } .ind { margin-left: 14px; }
    table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; } td, th { border: 1px solid #999; padding: 3px 6px; text-align: left; font-size: 10pt; } th { background: #eee; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 20px; }
    hr { border: none; border-top: 1px dashed #999; }
    .note { font-size: 8.5pt; color: #444; border: 1px solid #bbb; padding: 6px 8px; margin-bottom: 8px; }
    .foot { font-size: 8pt; color: #444; display: flex; justify-content: space-between; gap: 12px; border-top: 1px solid #000; padding-top: 3px; margin-top: 18px; }
  </style></head><body>
  <div class="top"><div><h1>Assessment Details</h1><div class="sub2">${cpEsc(d.assess_type || '')} — facility record</div></div><div style="text-align:right;font-size:9pt;"><b>${CP_FACILITY}</b><br>Resident record — confidential</div></div>
  <div class="note">Summary of the DSHS CARE Assessment Details on file, recorded by ${cpEsc(a.created_by || 'staff')}. The original document from the case manager is the official record${d.file_name ? ' (attached: ' + cpEsc(d.file_name) + ')' : ''}.</div>
  ${sec('Client Information', `<div class="grid"><div>${kv('Client Name', name)}${kv('Assessor Name', d.assessor)}${kv('Current Case Manager', d.case_manager)}${kv('Office', d.office)}</div><div>${kv('Client ACES ID', d.aces_id)}${kv('Client ADSA ID', d.adsa_id)}${kv('Assessment Date', cpFmt(d.assess_date))}${kv('Completed Date', cpFmt(d.completed_date))}</div></div>`)}
  ${sec('Reason For Assessment', `${cpLines(d.reason).length ? cpPara(d.reason) : ''}${kv('Was client the primary source of information?', d.primary_source)}${kv('Other sources of information', d.other_sources)}`)}
  ${sec('My Goals and Plans', list('My skills and gifts', d.goal_skills) + list('My relationships and interests', d.goal_relationships) + list('My perfect day', d.goal_perfect_day) + list('My favorite things/what makes me happy', d.goal_favorites) + list("What's important to me", d.goal_important) + list('Where I want to live', d.goal_live) + list('In the next year, I really want to', d.goal_next_year))}
  ${sec('Topics of Interest', cpLines(d.topics).length ? cpPara(d.topics) : '')}
  ${sec('General Strength(s) and Preference(s)', kv('Strengths', d.strengths) + kv('Preferences', d.preferences))}
  ${sec('Collateral Contacts', ccRows ? `<table><tr><th>Name</th><th>Relationship</th><th>Role</th><th>Phone</th></tr>${ccRows}</table>` : '')}
  ${sec('Safety', kv('Caregiver Instruction(s) and Safety Concerns', d.safety_instructions) + kv('AFH Evacuation Level', d.evac_level) + list('Legal Issues', d.legal_issues) + kv('How many times has client fallen within last 6 months?', d.falls_6mo) + kv('Consequence(s)', d.falls_consequences))}
  ${sec('Communication', kv('Modes of expression', d.comm_expression) + kv('Hearing', d.comm_hearing) + kv('Ability to See', d.comm_vision) + kv('Limitations', d.comm_limitations))}
  ${sec('Diagnosis', cpLines(d.diagnoses).length ? `<ol style="margin:0;padding-left:22px;">${cpLines(d.diagnoses).map(x => `<li>${cpEsc(x)}</li>`).join('')}</ol>` : '')}
  ${d.health_indicators || d.comatose ? `<div class="body">${kv('Health Indicators', d.health_indicators)}${kv('Is client comatose?', d.comatose)}</div>` : ''}
  ${sec('Medications', (cpLines(d.meds).length ? `<ol style="margin:0;padding-left:22px;">${cpLines(d.meds).map(x => `<li>${cpEsc(x)}</li>`).join('')}</ol>` : '') + kv('What are the routes?', d.med_routes) + kv('At most, how many times per day does the client take medications?', d.med_times_day))}
  ${sec('Medication Management', kv('Self Administration', d.med_self_admin) + kv('Frequency of need', d.med_frequency) + kv('Client Limitations', d.med_limitations) + kv('Caregiver Instructions', d.med_instructions))}
  ${sec('Pain', (painRows ? `<table><tr><th>Pain Site</th><th style="width:80px;">Score</th></tr>${painRows}</table>` : '') + kv('Frequency', d.pain_frequency) + kv('Pain Management', d.pain_management) + kv('Impact', d.pain_impact))}
  ${sec('Medical Additional Details', `<div class="grid"><div>${kv('Height', d.height)}${kv('Weight', d.weight ? d.weight + ' pounds' : '')}${kv('Body Mass Index', bmi)}${kv('Weight loss (5%/30 days or 10%/180 days)', d.wt_loss)}${kv('Weight gain (5%/30 days or 10%/180 days)', d.wt_gain)}</div><div>${kv('Self-rated health', d.health_rating)}${kv('Hospital admits (overnight), last 6 months', d.hosp_admits)}${kv('ER visits, last 6 months', d.er_visits)}${kv('Date of last doctor visit', d.last_doc_visit)}${kv('Doctor name', d.doctor)}</div></div>${list('Comment', d.med_comments)}`)}
  ${sec('Allergy', kv('Allergies, reactions, and immediate care needs', d.allergies))}
  ${sec('Treatments/Programs/Therapies', txRows ? `<table><tr><th>Type</th><th>Name</th><th>Provider</th><th>Frequency</th><th>Notes</th></tr>${txRows}</table>` : '')}
  ${sec('Sleep', kv('Care planning for sleep', d.sleep_planning) + kv('Is client satisfied with sleep quality?', d.sleep_satisfied) + kv('Notes', d.sleep_notes))}
  ${sec('Memory & Cognitive Performance', kv('Short term memory', d.mem_stm) + kv('Long term memory', d.mem_ltm) + kv('Oriented to person', d.oriented) + kv('Expressive', d.cog_expressive) + kv('Receptive', d.cog_receptive) + kv('Decisions', d.cog_decisions))}
  ${sec('Behavior', bh + kv('Was a referral made for CBHS/1915i eligibility?', d.cbhs_referral) + kv('Reason', d.cbhs_reason) + kv('Depression', d.depression_notes))}
  ${sec('Activities of Daily Living (ADLs)', kv('Functional limitations', d.adl_limitations) + kv('Days per week out of residence', d.days_out) + kv('Self-sufficiency compared to 90 days ago', d.self_sufficiency) + kv('Potential for improved function', d.potential) + kv('Task segmentation needed?', d.task_segmentation) + kv('Adjusts easily to change in routine?', d.adjusts_change) + adls)}
  ${sec('Continence Issues', kv('Bladder control (last 14 days)', d.bladder) + kv('Bowel control (last 14 days)', d.bowel) + kv('Bowel Pattern', d.bowel_pattern) + kv('Appliances & Programs', d.cont_appliances) + kv('Individual management', d.cont_management))}
  ${sec('Foot Care & Skin Care', kv('Foot Issues', d.foot_issues) + kv('Foot Care Needs', d.foot_needs) + kv('Skin Problems', d.skin_problems) + kv('Skin Care (other than feet)', d.skin_care) + kv('Pressure injuries', d.pressure_points) + kv('Number of current pressure injuries', d.pressure_injuries) + list('Skin/Foot Problem(s) Details', d.skin_details))}
  ${sec('Instrumental Activities of Daily Living (IADLs)', kv('Meal Preparation — Caregiver Instructions', d.meal_instructions) + kv('Diet', d.diet) + kv('Nutritional Problems', d.nutrition_problems) + kv('Oral hygiene and dental problems', d.oral_problems) + kv('Ordinary Housework — Caregiver Instructions', d.housework) + kv('Essential Shopping — Caregiver Instructions', d.shopping) + kv('Transportation — Caregiver Instructions', d.transport))}
  ${sec('Community Integration & Tobacco', kv('Does client want to participate in community activities?', d.community_wants) + kv('Needs assistance to participate?', d.community_assist) + list('Activities the caregiver will support', d.community_details) + list('Tobacco Use', d.tobacco))}
  ${sec('Provider Information', list('Informal Providers', d.providers_informal) + list('Formal Providers', d.providers_formal))}
  <div class="foot"><span>Client: ${cpEsc(name)} · ACES ID: ${cpEsc(d.aces_id || '—')} · ADSA ID: ${cpEsc(d.adsa_id || '—')}</span><span>CONFIDENTIAL · Assessment ${cpFmt(d.assess_date)} · Printed ${cpFmt(cpToday())}</span></div>
  </body></html>`;
}

async function printAD(id) {
  const { data: a } = await db.from('assessment_details').select('*').eq('id', id).maybeSingle();
  if (!a) { toast('Assessment Details not found'); return; }
  cpPrintWindow(adPrintHTML(a), `Assessment Details ${cpFmt(a.assessment_date)}`);
}
