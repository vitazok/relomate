import { z } from 'zod';
import { FieldSchema, ProvenanceSourceEnum } from '@/lib/case/schema';

export { ProvenanceSourceEnum };

const ProfileFieldSchema = FieldSchema;
const ObjectFieldSchema = FieldSchema;

export const Iso2 = z.string().length(2);

export const CurrentAddressValue = z.object({
  line1: z.string().nullable(),
  city: z.string().nullable(),
  stateOrProvince: z.string().nullable(),
  country: Iso2.nullable(),
  postalCode: z.string().nullable(),
});

export const ProfileSchema = z.object({
  schemaVersion: z.literal(1),

  fullName: ProfileFieldSchema(z.string()),
  dateOfBirth: ProfileFieldSchema(z.string().date()),
  placeOfBirth: ProfileFieldSchema(z.string()),
  gender: ProfileFieldSchema(z.enum(['male', 'female', 'diverse'])),
  nationality: ProfileFieldSchema(Iso2),

  passportNumber: ProfileFieldSchema(z.string()),
  passportExpiry: ProfileFieldSchema(z.string().date()),

  currentAddress: ObjectFieldSchema(CurrentAddressValue),
});

export type Profile = z.infer<typeof ProfileSchema>;
