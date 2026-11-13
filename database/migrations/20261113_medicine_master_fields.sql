-- ALZA Pharmacy: medicine master fields for Ingredients and doctor-sheet requirement.
-- Run once in Supabase SQL Editor before deploying the matching medicines frontend.

ALTER TABLE public.medicines
  ADD COLUMN IF NOT EXISTS ingredients text,
  ADD COLUMN IF NOT EXISTS need_doctor_sheet boolean NOT NULL DEFAULT false;

GRANT SELECT (ingredients, need_doctor_sheet)
  ON public.medicines TO authenticated;

GRANT INSERT (ingredients, need_doctor_sheet)
  ON public.medicines TO authenticated;

GRANT UPDATE (ingredients, need_doctor_sheet)
  ON public.medicines TO authenticated;
