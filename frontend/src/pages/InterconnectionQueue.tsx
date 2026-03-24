/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useCallback, useMemo } from 'react';
import { useDataset } from '../hooks/useDataset';
import {
  BarChart as ReBarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import Widget from '../components/Widget';
import DraggableGrid from '../components/DraggableGrid';
import type { GridItem } from '../components/DraggableGrid';
interface QueueRow {
  queue_pos: string; string; developer: string; fuel_type: string;
  sp_mw: number; wp_mw: number; zone: string; county: string; state: string;
  status: string; source_sheet: string; date_of_ir: string; proposed_cod: string;
  point_of_interconnection: string; utility: string; [key: string]: unknown;
}
interface ChangeRow {
  change_type: string; queue_pos: string; project_name: string; developer: string;
  fuel_type: string; sp_mw: number; zone: string; source_sheet: string;
  changed_fields: string; detected_at: string;
}
interface SummaryData { [key: string]: string | number; }
type SortKey = 'sp_mw' | 'developer' | 'zone' | 'queue_pos' | 'fuel_type' | 'project_name';
type SortDir = 'asc' | 'desc';
type SheetFilter = 'all' | 'active' | 'cluster' | 'in_service' | 'withdrawn';

const FUEL_LABELS: Record<string, string> = {
  S: 'Solar', W: 'Wind', ES: 'Storage', NG: 'Gas', NUC: 'Nuclear',
  H: 'Hydro', FO: 'Fuel Oil', AC: 'AC Transmission', DC: 'DC Transmission',
  WND: 'Wind', SOL: 'Solar', STG: 'Storage', HYB: 'Hybrid',
};
const COLORS = ['#2563eb','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#14b8a6','#6366f1','#84cc16','#f97316','#a855f7'];
function fuelLabel(code: string): string { return FUEL_LABELS[code] || code || 'Unknown'; }
function parseSummary(data: Record<string, unknown>[]): SummaryData {
  const map: SummaryData = {};
  for (const row of data) map[row.metric as string] = row.value as string | number;
  return map;
}
