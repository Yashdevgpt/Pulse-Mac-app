import type { DSP } from "@/lib/db";

export const createDspSlug = (name: string) => {
  const letterGroups = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .match(/[a-z]+/g);

  return letterGroups?.join("-") || "";
};

export const findDspBySlugOrId = (dsps: DSP[], slugOrId: string) =>
  dsps.find((dsp) => dsp.id === slugOrId) ||
  dsps.find((dsp) => createDspSlug(dsp.name) === slugOrId);
