import type { CaseFacts } from '@/lib/case/schema';
import { getAtPath, validateLeafPath } from '@/lib/case/paths';
import type { Profile } from '@/lib/profile/schema';

export type VidexFieldValue = string | boolean;
export type VidexMissingReason = 'missing_source' | 'not_modelled' | 'manual_signature';

export interface VidexFieldDefinition {
  fieldNumber: number;
  label: string;
  acroFormFieldIds: string[];
  sourcePaths: string[];
  transform: string;
}

export interface VidexMissingField {
  fieldNumber: number;
  label: string;
  acroFormFieldIds: string[];
  sourcePaths: string[];
  reason: VidexMissingReason;
}

export interface VidexFieldReport {
  fieldNumber: number;
  label: string;
  acroFormFieldIds: string[];
  sourcePaths: string[];
  status: 'filled' | 'missing';
  outputFieldIds: string[];
  missingReason?: VidexMissingReason;
}

export interface VidexCompletenessReport {
  total: number;
  filled: number;
  missing: VidexMissingField[];
  values: Record<string, VidexFieldValue>;
  fields: VidexFieldReport[];
}

export interface AssessVidexCompletenessInput {
  profile: Profile | null;
  caseFacts: CaseFacts;
  today?: Date;
}

type EvalContext = Required<AssessVidexCompletenessInput>;
type FieldEval =
  | { status: 'filled'; values: Record<string, VidexFieldValue> }
  | { status: 'missing'; reason: VidexMissingReason };

type FieldEvaluator = (ctx: EvalContext) => FieldEval;

const COUNTRY_NAMES: Record<string, string> = {
  CA: 'Canada',
  DE: 'Germany',
  IN: 'India',
  US: 'United States',
};

export function mapIso2CountryName(code: string): string {
  return COUNTRY_NAMES[code.toUpperCase()] ?? code;
}

export function formatVidexDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

function filled(values: Record<string, VidexFieldValue>): FieldEval {
  return { status: 'filled', values };
}

function missing(reason: VidexMissingReason): FieldEval {
  return { status: 'missing', reason };
}

function field(
  fieldNumber: number,
  label: string,
  acroFormFieldIds: string[],
  sourcePaths: string[],
  transform: string,
  evaluate: FieldEvaluator,
): VidexFieldDefinition & { evaluate: FieldEvaluator } {
  return { fieldNumber, label, acroFormFieldIds, sourcePaths, transform, evaluate };
}

function rawAt(ctx: EvalContext, path: string): unknown {
  const { kind } = validateLeafPath(path);
  const root =
    kind === 'profile'
      ? ((ctx.profile ?? { schemaVersion: 1 }) as unknown as Record<string, unknown>)
      : (ctx.caseFacts as unknown as Record<string, unknown>);
  const node = getAtPath(root, path);
  if (!node || typeof node !== 'object' || !('value' in node)) return undefined;
  const value = (node as { value: unknown }).value;
  return value === null ? undefined : value;
}

function stringAt(ctx: EvalContext, path: string): string | undefined {
  const value = rawAt(ctx, path);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function numberAt(ctx: EvalContext, path: string): number | undefined {
  const value = rawAt(ctx, path);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function boolAt(ctx: EvalContext, path: string): boolean | undefined {
  const value = rawAt(ctx, path);
  return typeof value === 'boolean' ? value : undefined;
}

function addressAt(ctx: EvalContext): {
  line1: string | null;
  city: string | null;
  stateOrProvince: string | null;
  country: string | null;
  postalCode: string | null;
} | undefined {
  const value = rawAt(ctx, 'currentAddress');
  if (!value || typeof value !== 'object') return undefined;
  return value as ReturnType<typeof addressAt>;
}

function splitFullName(ctx: EvalContext): { givenNames: string; surname: string } | undefined {
  const fullName = stringAt(ctx, 'fullName');
  if (!fullName) return undefined;
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return undefined;
  if (parts.length === 1) {
    return { givenNames: parts[0] as string, surname: parts[0] as string };
  }
  const surname = parts[parts.length - 1] as string;
  return { givenNames: parts.slice(0, -1).join(' '), surname };
}

function consulatePlace(ctx: EvalContext): string | undefined {
  const consulate = stringAt(ctx, 'target.targetConsulate');
  if (consulate === 'bengaluru') return 'Bengaluru';
  if (consulate === 'toronto') return 'Toronto';
  return undefined;
}

function isAdult(ctx: EvalContext): boolean | undefined {
  const dob = stringAt(ctx, 'dateOfBirth');
  if (!dob) return undefined;
  const birth = new Date(`${dob}T00:00:00.000Z`);
  if (Number.isNaN(birth.getTime())) return undefined;
  const age = ctx.today.getUTCFullYear() - birth.getUTCFullYear();
  const hadBirthday =
    ctx.today.getUTCMonth() > birth.getUTCMonth() ||
    (ctx.today.getUTCMonth() === birth.getUTCMonth() &&
      ctx.today.getUTCDate() >= birth.getUTCDate());
  return age > 18 || (age === 18 && hadBirthday);
}

const notApplicable = (acroFormFieldId: string): FieldEval => filled({ [acroFormFieldId]: 'N/A' });

const FIELD_DEFINITIONS = [
  field(1, 'Surname', ['applicantSurname'], ['fullName'], 'surnameFromFullNameUppercase', (ctx) => {
    const name = splitFullName(ctx);
    return name ? filled({ applicantSurname: name.surname.toUpperCase() }) : missing('missing_source');
  }),
  field(2, 'Surname at birth', ['applicantSurnameAtBirth'], ['fullName'], 'notModelledYet', () =>
    missing('not_modelled'),
  ),
  field(3, 'First name(s)', ['applicantFirstname'], ['fullName'], 'givenNamesFromFullNameUppercase', (ctx) => {
    const name = splitFullName(ctx);
    return name ? filled({ applicantFirstname: name.givenNames.toUpperCase() }) : missing('missing_source');
  }),
  field(4, 'Date of birth', ['applicantDateOfBirth'], ['dateOfBirth'], 'DD/MM/YYYY', (ctx) => {
    const date = stringAt(ctx, 'dateOfBirth');
    return date ? filled({ applicantDateOfBirth: formatVidexDate(date) }) : missing('missing_source');
  }),
  field(5, 'Place of birth', ['applicantPlaceOfBirth'], ['placeOfBirth'], 'identity', (ctx) => {
    const place = stringAt(ctx, 'placeOfBirth');
    return place ? filled({ applicantPlaceOfBirth: place }) : missing('missing_source');
  }),
  field(6, 'Country of birth', ['applicantCountryOfBirth'], ['nationality'], 'notModelledYet', () =>
    missing('not_modelled'),
  ),
  field(
    7,
    'Current nationality',
    ['applicantNationality'],
    ['nationality'],
    'ISO2_COUNTRY_NAME',
    (ctx) => {
      const nationality = stringAt(ctx, 'nationality');
      return nationality
        ? filled({ applicantNationality: mapIso2CountryName(nationality) })
        : missing('missing_source');
    },
  ),
  field(
    8,
    'Sex',
    ['applicantGenderM', 'applicantGenderF', 'applicantGenderA'],
    ['gender'],
    'genderRadio',
    (ctx) => {
      const gender = stringAt(ctx, 'gender');
      if (!gender) return missing('missing_source');
      return filled({
        applicantGenderM: gender === 'male',
        applicantGenderF: gender === 'female',
        applicantGenderA: gender === 'diverse',
      });
    },
  ),
  field(
    9,
    'Marital status',
    [
      'applicantMaritalCEL',
      'applicantMaritalMAR',
      'applicantMaritalSEP',
      'applicantMaritalDIV',
      'applicantMaritalVEU',
      'applicantMaritalAUT',
    ],
    ['family.maritalStatus'],
    'maritalStatusRadio',
    (ctx) => {
      const maritalStatus = stringAt(ctx, 'family.maritalStatus');
      if (!maritalStatus) return missing('missing_source');
      const idByStatus: Record<string, string> = {
        single: 'applicantMaritalCEL',
        married: 'applicantMaritalMAR',
        partnership: 'applicantMaritalPAC',
        divorced: 'applicantMaritalDIV',
        widowed: 'applicantMaritalVEU',
      };
      const fieldId = idByStatus[maritalStatus] ?? 'applicantMaritalAUT';
      return filled({ [fieldId]: true });
    },
  ),
  field(
    10,
    'Parental authority or legal guardian',
    ['parental1Names', 'parental1AddressL1', 'parental2Names', 'parental2AddressL1'],
    ['dateOfBirth'],
    'adultNotApplicable',
    (ctx) => {
      const adult = isAdult(ctx);
      if (adult === undefined) return missing('missing_source');
      return adult ? filled({ parental1Names: 'N/A' }) : missing('not_modelled');
    },
  ),
  field(11, 'National identity number', ['applicantIdCardNumber'], ['nationality'], 'notModelledYet', () =>
    missing('not_modelled'),
  ),
  field(12, 'Type of travel document', ['travelDocTypePSP'], ['passportNumber'], 'ordinaryPassport', (ctx) =>
    stringAt(ctx, 'passportNumber') ? filled({ travelDocTypePSP: true }) : missing('missing_source'),
  ),
  field(13, 'Number of travel document', ['travelDocNumber'], ['passportNumber'], 'identity', (ctx) => {
    const passportNumber = stringAt(ctx, 'passportNumber');
    return passportNumber ? filled({ travelDocNumber: passportNumber }) : missing('missing_source');
  }),
  field(14, 'Date of issue of travel document', ['travelDocDateOfIssue'], ['passportNumber'], 'notModelledYet', () =>
    missing('not_modelled'),
  ),
  field(15, 'Valid until', ['travelDocValidUntil'], ['passportExpiry'], 'DD/MM/YYYY', (ctx) => {
    const expiry = stringAt(ctx, 'passportExpiry');
    return expiry ? filled({ travelDocValidUntil: formatVidexDate(expiry) }) : missing('missing_source');
  }),
  field(16, 'Issued by', ['travelDocCountries'], ['passportNumber'], 'notModelledYet', () =>
    missing('not_modelled'),
  ),
  field(17, 'Family member of EU, EEA, or CH citizen', ['nationalFamilySurname'], ['target.intendedVisa'], 'blueCardNotApplicable', () =>
    notApplicable('nationalFamilySurname'),
  ),
  field(18, 'Residence in a country other than nationality', ['applicantResidencePermitNo'], ['nationality'], 'notModelledYet', () =>
    missing('not_modelled'),
  ),
  field(19, 'Home address, email, and phone number', ['applicantAddressL1', 'applicantAddressL2', 'applicantAddressL3', 'applicantAddressL4'], ['currentAddress'], 'addressLines', (ctx) => {
    const address = addressAt(ctx);
    if (!address?.line1 || !address.city || !address.country) return missing('missing_source');
    return filled({
      applicantAddressL1: address.line1,
      applicantAddressL2: address.city,
      applicantAddressL3: [address.stateOrProvince, address.postalCode].filter(Boolean).join(' '),
      applicantAddressL4: mapIso2CountryName(address.country),
    });
  }),
  field(
    20,
    'Current occupation and employer',
    ['applicantOccupation', 'applicantOccupationAddressL1', 'applicantOccupationAddressL2'],
    ['employment.jobTitle', 'employment.employerName', 'employment.employerCity'],
    'employmentLines',
    (ctx) => {
      const jobTitle = stringAt(ctx, 'employment.jobTitle');
      const employerName = stringAt(ctx, 'employment.employerName');
      const employerCity = stringAt(ctx, 'employment.employerCity');
      if (!jobTitle || !employerName) return missing('missing_source');
      return filled({
        applicantOccupation: jobTitle,
        applicantOccupationAddressL1: employerName,
        ...(employerCity ? { applicantOccupationAddressL2: employerCity } : {}),
      });
    },
  ),
  field(21, 'Main purpose of journey', ['purposeAUTR', 'purposeOfJourneyInfo'], ['target.intendedVisa'], 'blueCardPurpose', (ctx) =>
    stringAt(ctx, 'target.intendedVisa') === 'blue_card'
      ? filled({ purposeAUTR: true, purposeOfJourneyInfo: 'Employment / EU Blue Card' })
      : missing('missing_source'),
  ),
  field(22, 'Member State of destination', ['applicantDestinations'], ['target.intendedVisa'], 'blueCardDestination', (ctx) =>
    stringAt(ctx, 'target.intendedVisa') === 'blue_card'
      ? filled({ applicantDestinations: 'Germany' })
      : missing('missing_source'),
  ),
  field(23, 'Member State of first entry', ['applicantDestinationFirstEntry'], ['target.intendedVisa'], 'notModelledYet', () =>
    missing('not_modelled'),
  ),
  field(24, 'Number of entries requested', ['entries1', 'entries2', 'entriesM'], ['target.intendedVisa'], 'notModelledYet', () =>
    missing('not_modelled'),
  ),
  field(25, 'Duration of intended stay', ['purposeOther'], ['target.intendedVisa'], 'blueCardLongStay', (ctx) =>
    stringAt(ctx, 'target.intendedVisa') === 'blue_card'
      ? filled({ purposeOther: 'Long-term employment residence' })
      : missing('missing_source'),
  ),
  field(26, 'Schengen visas issued during the past three years', ['formerBiometricVisa'], ['target.intendedVisa'], 'notModelledYet', () =>
    missing('not_modelled'),
  ),
  field(27, 'Fingerprints collected previously', ['hasFingerprintsTrue', 'hasFingerprintsFalse', 'fingerprintsDate'], ['passportNumber'], 'notModelledYet', () =>
    missing('not_modelled'),
  ),
  field(28, 'Entry permit for final destination', ['entryPermitAuthority'], ['target.intendedVisa'], 'blueCardNotApplicable', () =>
    notApplicable('entryPermitAuthority'),
  ),
  field(29, 'Intended date of arrival', ['dateOfArrival'], ['target.targetMoveDate'], 'DD/MM/YYYY', (ctx) => {
    const moveDate = stringAt(ctx, 'target.targetMoveDate');
    return moveDate ? filled({ dateOfArrival: formatVidexDate(moveDate) }) : missing('missing_source');
  }),
  field(30, 'Intended date of departure', ['dateOfDeparture'], ['target.intendedVisa'], 'blueCardNotApplicable', () =>
    filled({ dateOfDeparture: 'N/A' }),
  ),
  field(31, 'Inviting person or accommodation', ['host1Names', 'host1AddressL1'], ['employment.employerName', 'employment.employerCity'], 'employerAsHost', (ctx) => {
    const employerName = stringAt(ctx, 'employment.employerName');
    const employerCity = stringAt(ctx, 'employment.employerCity');
    if (!employerName) return missing('missing_source');
    return filled({
      host1Names: employerName,
      ...(employerCity ? { host1AddressL1: employerCity } : {}),
    });
  }),
  field(32, 'Inviting company or organization', ['hostOrganizationAddressL1', 'hostOrganizationAddressL2'], ['employment.employerName', 'employment.employerCity'], 'employerOrganization', (ctx) => {
    const employerName = stringAt(ctx, 'employment.employerName');
    const employerCity = stringAt(ctx, 'employment.employerCity');
    if (!employerName) return missing('missing_source');
    return filled({
      hostOrganizationAddressL1: employerName,
      ...(employerCity ? { hostOrganizationAddressL2: employerCity } : {}),
    });
  }),
  field(33, 'Cost of travelling and living during stay', ['sponsorTypeM', 'fundingTypeM_AUT'], ['employment.annualGrossSalaryEur'], 'employmentIncome', (ctx) =>
    numberAt(ctx, 'employment.annualGrossSalaryEur') !== undefined
      ? filled({ sponsorTypeM: true, fundingTypeM_AUT: true })
      : missing('missing_source'),
  ),
  field(34, 'EU, EEA, or CH family member personal data', ['nationalFamilyFirstNames'], ['target.intendedVisa'], 'blueCardNotApplicable', () =>
    notApplicable('nationalFamilyFirstNames'),
  ),
  field(35, 'Relationship to EU, EEA, or CH citizen', ['relationshipAUT'], ['target.intendedVisa'], 'blueCardNotApplicable', () =>
    notApplicable('relationshipAUT'),
  ),
  field(36, 'Place and date', ['townAndDateTime'], ['target.targetConsulate'], 'consulateAndCurrentDate', (ctx) => {
    const place = consulatePlace(ctx);
    return place
      ? filled({ townAndDateTime: `${place}, ${formatVidexDate(ctx.today.toISOString().slice(0, 10))}` })
      : missing('missing_source');
  }),
  field(37, 'Signature', [], ['fullName'], 'manualSignature', () => missing('manual_signature')),
] satisfies Array<VidexFieldDefinition & { evaluate: FieldEvaluator }>;

export const VIDEX_FIELDS: VidexFieldDefinition[] = FIELD_DEFINITIONS.map(
  ({ evaluate: _evaluate, ...definition }) => definition,
);

for (const fieldDefinition of VIDEX_FIELDS) {
  for (const path of fieldDefinition.sourcePaths) {
    validateLeafPath(path);
  }
}

export function assessVidexCompleteness(
  input: AssessVidexCompletenessInput,
): VidexCompletenessReport {
  const ctx: EvalContext = {
    profile: input.profile ?? { schemaVersion: 1 },
    caseFacts: input.caseFacts,
    today: input.today ?? new Date(),
  };
  const values: Record<string, VidexFieldValue> = {};
  const missingFields: VidexMissingField[] = [];
  const fields: VidexFieldReport[] = [];

  for (const definition of FIELD_DEFINITIONS) {
    const result = definition.evaluate(ctx);
    if (result.status === 'filled') {
      Object.assign(values, result.values);
      fields.push({
        fieldNumber: definition.fieldNumber,
        label: definition.label,
        acroFormFieldIds: definition.acroFormFieldIds,
        sourcePaths: definition.sourcePaths,
        status: 'filled',
        outputFieldIds: Object.keys(result.values),
      });
    } else {
      const missingField = {
        fieldNumber: definition.fieldNumber,
        label: definition.label,
        acroFormFieldIds: definition.acroFormFieldIds,
        sourcePaths: definition.sourcePaths,
        reason: result.reason,
      };
      missingFields.push(missingField);
      fields.push({
        fieldNumber: definition.fieldNumber,
        label: definition.label,
        acroFormFieldIds: definition.acroFormFieldIds,
        sourcePaths: definition.sourcePaths,
        status: 'missing',
        outputFieldIds: [],
        missingReason: result.reason,
      });
    }
  }

  return {
    total: FIELD_DEFINITIONS.length,
    filled: fields.filter((fieldReport) => fieldReport.status === 'filled').length,
    missing: missingFields,
    values,
    fields,
  };
}
