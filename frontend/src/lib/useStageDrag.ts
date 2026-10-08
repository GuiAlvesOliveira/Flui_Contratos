import { useCallback, useState, type DragEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import type { ToastMessage } from '../components/Toast';
import { allowedTransitions, STAGE_LABELS, type ProcessStage } from './processStages';

export interface DragCard {
  id: string;
  stage: ProcessStage;
  stageBeforePendencia: ProcessStage | null;
}

interface StageErrorBody {
  message?: string | string[];
  pendingDocs?: { label: string; status: string }[];
}

// FE-24: arrastar um card para outra coluna usa a mesma mudança de etapa da API
// (PATCH /processes/:id/stage). Só as etapas da máquina de estados aceitam o
// card; o gate de documentos (RN-04) e o MIP/DFI (RN-05) continuam na API e
// voltam como aviso, com a lista de documentos pendentes.
export function useStageDrag(enabled: boolean) {
  const qc = useQueryClient();
  const [dragging, setDragging] = useState<DragCard | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  const move = useMutation({
    mutationFn: ({ card, toStage }: { card: DragCard; toStage: ProcessStage }) =>
      api.patch(`/processes/${card.id}/stage`, { toStage }),
    onSuccess: (_res, { card, toStage }) => {
      void qc.invalidateQueries({ queryKey: ['processes'] });
      void qc.invalidateQueries({ queryKey: ['process', card.id] });
      void qc.invalidateQueries({ queryKey: ['audit', card.id] });
      setToast({ kind: 'success', title: `Processo movido para ${STAGE_LABELS[toStage]}` });
    },
    onError: (err: unknown) => {
      const body = (err as { response?: { data?: StageErrorBody } })?.response?.data;
      const msg = Array.isArray(body?.message) ? body.message.join('; ') : body?.message;
      setToast({
        kind: 'error',
        title: msg ?? 'Não foi possível mover o processo',
        detail: body?.pendingDocs?.map(d => d.label),
      });
    },
  });

  const canDrop = (stage: ProcessStage) =>
    !!dragging && allowedTransitions(dragging.stage, dragging.stageBeforePendencia).includes(stage);

  const cardProps = (card: DragCard) => (enabled ? {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.id);
      setDragging(card);
    },
    onDragEnd: () => setDragging(null),
    'data-dragging': dragging?.id === card.id ? 'true' : undefined,
  } : {});

  // data-drop pinta a coluna durante o arraste: "ok" aceita, "blocked" recusa
  const columnProps = (stage: ProcessStage) => (enabled ? {
    onDragOver: (e: DragEvent) => {
      if (!canDrop(stage)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      if (dragging && canDrop(stage)) move.mutate({ card: dragging, toStage: stage });
      setDragging(null);
    },
    'data-drop': dragging && dragging.stage !== stage ? (canDrop(stage) ? 'ok' : 'blocked') : undefined,
  } : {});

  return { cardProps, columnProps, toast, dismissToast };
}
