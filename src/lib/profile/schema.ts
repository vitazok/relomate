import { z } from 'zod';
import { FieldSchema, ProvenanceSourceEnum } from '@/lib/case/schema';

export { ProvenanceSourceEnum };

export const Iso2 = z.string().length(2);

export const CurrentAddressValue = z.object({
  line1: z.string().nullable(),
  city: z.string().nullable(),
  stateOrProvince: z.string().nullable(),
  country: Iso2.nullable(),
  postalCode: z.string().nullable(),
});

const Optional = <T extends z.ZodTypeAny>(inner: T) => FieldSchema(inner).optional();

export const ProfileSchema = z.object({
  schemaVersion: z.literal(1).default(1),

  fullName: Optional(z.string()),
  dateOfBirth: Optional(z.string().date()),
  placeOfBirth: Optional(z.string()),
  gender: Optional(z.enum(['male', 'female', 'diverse'])),
  nationality: Optional(Iso2),

  passportNumber: Optional(z.string()),
  passportExpiry: Optional(z.string().date()),

  currentAddress: Optional(CurrentAddressValue),
});

export type Profile = z.infer<typeof ProfileSchema>;
