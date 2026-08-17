"use client";

import { useEffect, useRef, useState } from "react";
import ActivityChoicePanel from "./ActivityChoicePanel";
import {
  ActivityOption,
  AdjustAction,
  AdjustOperationResult,
  TripPlan,
} from "@/lib/types";

type ChatChoice = {
  dayIndex: number;
  blockId: string;
  action: "replace" | "add";
  title: string;
  options: ActivityOption[];
  searchQuery?: string;
  rejectedOptionNames: string[];
  preRemoveBlockIds?: string[];
};

interface Props {
  plan: TripPlan;
  onAdjust: (dayIndex: number, blockId: string, action: AdjustAction, option?: ActivityOption, anchorBlockId?: string) => Promise<AdjustOperationResult>;
  onGetChoices: (
    dayIndex: number,
    blockId: string,
    action?: "replace" | "add",
    addQuery?: string,
    recommendOnly?: boolean,
    excludeNames?: string[]
  ) => Promise<ActivityOption[]>;
  loadingChoices?: boolean;
  activeDayIndex: number;
  adjustingBlockId?: string | null;
  onCancelAdjust: () => void;
  suggestedPrompt?: { id: string; text: string } | null;
}

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  resolutionOptions?: string[];
  /** 可核对的工具与状态轨迹，不展示模型内部思维内容。 */
  agentSteps?: string[];
};

const CANCEL_REQUEST = /(?:取消|停止|算了|不要了|别改了|撤销)/;
const CHAT_TIMEOUT_MS = 90_000;

function AssistantMessageText({ text }: { text: string }) {
  const paragraphs = text.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm leading-6 text-gray-800">
      {paragraphs.map((paragraph, index) => (
        <p key={`${index}-${paragraph.slice(0, 24)}`} className={index ? "mt-2" : undefined}>
          {paragraph}
        </p>
      ))}
    </div>
  );
}

export default function PlanAssistantChat({
  plan,
  onAdjust,
  onGetChoices,
  loadingChoices,
  activeDayIndex,
  adjustingBlockId,
  onCancelAdjust,
  suggestedPrompt,
}: Props) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [choice, setChoice] = useState<ChatChoice | null>(null);
  const [choiceUpdating, setChoiceUpdating] = useState(false);
  const [agentStage, setAgentStage] = useState<string | null>(null);
  const choiceRequestInFlight = useRef(false);
  const chatAbortController = useRef<AbortController | null>(null);
  const chatTimedOut = useRef(false);
  const suppressNextCancelledResult = useRef(false);
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const latestAssistantReplyRef = useRef<HTMLDivElement | null>(null);
  const choicePanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => chatAbortController.current?.abort(), []);

  // 质检 Agent 只负责把待处理项交给既有聊天 Agent；用户仍可编辑并亲自发送。
  useEffect(() => {
    if (!suggestedPrompt?.text) return;
    const timer = window.setTimeout(() => setInput(suggestedPrompt.text), 0);
    return () => window.clearTimeout(timer);
  }, [suggestedPrompt?.id, suggestedPrompt?.text]);

  // 对话区自身有滚动容器；新消息抵达时自动展示最新答复，用户不必再手动向下找。
  useEffect(() => {
    if (!messages.length) return;
    const frame = window.requestAnimationFrame(() => {
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      chatLogRef.current?.scrollTo({ top: chatLogRef.current.scrollHeight, behavior });
      latestAssistantReplyRef.current?.scrollIntoView({ behavior, block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages]);

  // 候选卡出现时也带到可视范围，避免只看到“已找到方案”的文字而看不到方案本身。
  useEffect(() => {
    if (!choice) return;
    const frame = window.requestAnimationFrame(() => {
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      choicePanelRef.current?.scrollIntoView({ behavior, block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [choice]);

  const cancelAssistantRequest = () => {
    if (adjustingBlockId) {
      onCancelAdjust();
      return;
    }
    chatTimedOut.current = false;
    chatAbortController.current?.abort();
  };

  const showChoice = async (
    dayIndex: number,
    blockId: string,
    action: "replace" | "add",
    searchQuery?: string,
    recommendOnly = false,
    rejectedOptionNames: string[] = []
  ) => {
    const target = plan.dailyPlans[dayIndex]?.blocks.find(
      (block) => block.type === "activity" && block.id === blockId
    );
    if (!target || target.type !== "activity") throw new Error("没有找到要调整的行程。当前行程没有变化。");
    const options = await onGetChoices(dayIndex, blockId, action, searchQuery, recommendOnly, rejectedOptionNames);
    setChoice({ dayIndex, blockId, action, title: target.title, options, searchQuery, rejectedOptionNames });
    return options;
  };

  const send = async () => {
    const message = input.trim();
    if (!message || loading) return;
    setInput("");
    setMessages((current) => [...current, { role: "user", text: message }]);
    if (adjustingBlockId) {
      if (CANCEL_REQUEST.test(message)) {
        suppressNextCancelledResult.current = choiceUpdating;
        onCancelAdjust();
        setMessages((current) => [
          ...current,
          { role: "assistant", text: "已取消正在进行的行程调整；未完成的结果不会保存。" },
        ]);
      } else {
        setMessages((current) => [
          ...current,
          { role: "assistant", text: "上一项行程仍在重新计算。请等待完成，或直接说“取消”终止它后再调整。" },
        ]);
      }
      return;
    }
    setLoading(true);
    setAgentStage("正在理解日期、位置和你想做的事情…");
    const controller = new AbortController();
    chatAbortController.current = controller;
    chatTimedOut.current = false;
    const timeout = window.setTimeout(() => {
      chatTimedOut.current = true;
      controller.abort();
    }, CHAT_TIMEOUT_MS);
    try {
      const response = await fetch("/api/plan-assistant-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan,
          message,
          activeDayIndex,
          history: [...messages, { role: "user" as const, text: message }],
          pendingChoice: choice
            ? {
                action: choice.action,
                blockId: choice.blockId,
                searchQuery: choice.searchQuery,
                optionNames: choice.options.map((option) => option.name),
                options: choice.options,
              }
            : undefined,
          }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "调整失败，请重试。");
      const agentSteps = Array.isArray(data.agentSteps)
        ? data.agentSteps.map(String).filter(Boolean).slice(0, 12)
        : undefined;
      if (data.candidateContextAction === "clear") {
        setChoice(null);
      }
      if (data.action && data.blockId) {
        const dayIndex = plan.dailyPlans.findIndex((day) => day.blocks.some((block) => block.id === data.blockId));
        if (dayIndex < 0) throw new Error("没有找到要调整的行程。当前行程没有变化。");
        if (data.action === "replace" || data.action === "add") {
          const agentOptions = Array.isArray(data.options)
            ? (data.options as ActivityOption[])
            : null;
          let options: ActivityOption[];
          if (agentOptions) {
            options = agentOptions.map((option) => ({
              ...option,
              previewBaseRevision: plan.revision || 0,
            }));
            const first = options[0];
            const proposalDayIndex = data.action === "replace"
              ? dayIndex
              : first?.proposedDayIndex ?? dayIndex;
            const proposalBlockId = data.action === "replace"
              ? data.blockId
              : first?.proposedAnchorBlockId || data.blockId;
            setChoice({
              dayIndex: proposalDayIndex,
              blockId: proposalBlockId,
              action: data.action,
              title: first?.proposedAnchorTitle || "Agent 推荐方案",
              options,
              searchQuery: data.searchQuery,
              rejectedOptionNames: [],
              preRemoveBlockIds: Array.isArray(data.plannedOperations)
                ? data.plannedOperations
                    .filter((operation: { type?: string; blockId?: string }) => operation.type === "remove" && operation.blockId)
                    .map((operation: { blockId: string }) => operation.blockId)
                : undefined,
            });
          } else {
            setAgentStage("正在调用地图，核对地点并整理候选…");
            options = await showChoice(
              dayIndex,
              data.blockId,
              data.action,
              data.searchQuery,
              Boolean(data.recommendOnly || data.action === "replace"),
              Array.isArray(data.excludeNames) ? data.excludeNames : []
            );
          }
          setMessages((current) => [
            ...current,
            {
              role: "assistant",
              text: options.length
                ? agentOptions
                  ? `已找到 ${options.length} 个可行方案。请直接在下方选择；确认前不会修改行程。`
                  : (data.reply || "我找到了可核对的候选，请直接在本次对话里的候选卡选择；确认后才更新上方行程。")
                : "没有找到可核对的候选，当前行程没有变化。你可以补充口味、预算或想去的具体地点再试。",
              agentSteps,
            },
          ]);
        } else {
          setAgentStage("正在更新行程，并核对页面是否真的发生变化…");
          const result = await onAdjust(dayIndex, data.blockId, data.action, undefined, data.anchorBlockId);
          setMessages((current) => [
            ...current,
            {
              role: "assistant",
              text: result.message,
              resolutionOptions: result.resolutionOptions,
              agentSteps,
            },
          ]);
        }
      } else {
        setMessages((current) => [...current, { role: "assistant", text: data.reply, agentSteps }]);
      }
    } catch (error) {
      const text =
        error instanceof DOMException && error.name === "AbortError"
          ? chatTimedOut.current
            ? "行程 Agent 在 90 秒内未完成地图核对，本次请求已取消，当前行程没有变化。你可以缩小地点范围或换一个条件再试。"
            : "已取消本次理解请求，当前行程没有变化。"
          : error instanceof Error
            ? error.message
            : "调整失败，请重试。";
      setMessages((current) => [...current, { role: "assistant", text }]);
    } finally {
      window.clearTimeout(timeout);
      if (chatAbortController.current === controller) chatAbortController.current = null;
      setLoading(false);
      setAgentStage(null);
    }
  };

  const chooseChatOption = async (option: ActivityOption) => {
    if (!choice || choiceUpdating || choiceRequestInFlight.current) return;
    choiceRequestInFlight.current = true;
    setChoiceUpdating(true);
    try {
      const selectedDayIndex = option.proposedDayIndex ?? choice.dayIndex;
      const selectedBlockId = option.proposedAnchorBlockId || choice.blockId;
      const result = await onAdjust(
        selectedDayIndex,
        selectedBlockId,
        choice.action,
        { ...option, preRemoveBlockIds: choice.preRemoveBlockIds }
      );
      if (result.status !== "applied") {
        if (
          result.reasonCode === "request-cancelled" &&
          suppressNextCancelledResult.current
        ) {
          suppressNextCancelledResult.current = false;
          return;
        }
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            text: result.message,
            resolutionOptions: result.resolutionOptions,
          },
        ]);
        return;
      }
      setChoice(null);
      setMessages((current) => [
        ...current,
        { role: "assistant", text: result.message },
      ]);
    } finally {
      choiceRequestInFlight.current = false;
      setChoiceUpdating(false);
    }
  };

  const recommendAgain = async () => {
    if (!choice) return;
    const rejected = [...choice.rejectedOptionNames, ...choice.options.map((option) => option.name)];
    const options = await showChoice(choice.dayIndex, choice.blockId, choice.action, choice.searchQuery, true, rejected);
    if (!options.length) {
      setMessages((current) => [...current, { role: "assistant", text: "附近暂时没有更多不重复的可核对候选。告诉我口味、预算或具体地点，我再按这个条件找。" }]);
    }
  };

  return (
    <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">行程小助手</h2>
      <p className="mt-1 text-xs text-gray-600">可以删除、延长、替换已有活动，或新增你明确说出的地点。候选会直接显示在这段对话里，确认后才更新上方行程。</p>
      {messages.length > 0 && <div ref={chatLogRef} className="mt-3 max-h-64 space-y-2 overflow-y-auto" aria-live="polite">
        {messages.map((item, index) => (
          <div
            key={index}
            ref={item.role === "assistant" ? latestAssistantReplyRef : undefined}
            className={item.role === "user" ? "ml-auto w-fit max-w-[88%]" : "w-fit max-w-[88%]"}
          >
            {item.role === "user" ? (
              <p className="rounded-2xl bg-teal-700 px-3 py-2 text-sm leading-6 text-white">{item.text}</p>
            ) : (
              <AssistantMessageText text={item.text} />
            )}
            {item.role === "assistant" && item.agentSteps?.length ? (
              <details className="mt-2 rounded-xl border border-teal-100 bg-teal-50/70 px-3 py-2 text-xs text-teal-950">
                <summary className="cursor-pointer select-none font-medium">查看本轮 Agent 执行记录</summary>
                <ol className="mt-2 space-y-1.5 border-l border-teal-200 pl-4">
                  {item.agentSteps.map((step, stepIndex) => (
                    <li key={`${stepIndex}-${step.slice(0, 32)}`}>
                      <span className="mr-1 text-teal-600">{stepIndex + 1}.</span>
                      {step}
                    </li>
                  ))}
                </ol>
                <p className="mt-2 text-[11px] text-teal-700">这里只展示工具与状态记录，不展示模型内部思维过程。</p>
              </details>
            ) : null}
            {item.role === "assistant" && item.resolutionOptions?.length ? (
              <div className="mt-2 flex flex-wrap gap-2" aria-label="可选处理方式">
                {item.resolutionOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setInput(option)}
                    className="cursor-pointer rounded-full border border-teal-200 bg-white px-3 py-1.5 text-xs text-teal-800 transition-colors hover:bg-teal-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
                  >
                    {option}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>}
      {agentStage && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-900" role="status" aria-live="polite">
          <svg className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="flex-1">{agentStage}</span>
          <button
            type="button"
            onClick={cancelAssistantRequest}
            className="rounded-full border border-teal-300 bg-white px-2.5 py-1 text-xs font-medium text-teal-800 hover:bg-teal-100"
          >
            取消
          </button>
        </div>
      )}
      {choice && (
        <div ref={choicePanelRef} className="mt-3">
          <ActivityChoicePanel
            title={choice.title}
            options={choice.options}
            busy={loading || loadingChoices || choiceUpdating || Boolean(adjustingBlockId)}
            recommending={loadingChoices}
            onClose={() => setChoice(null)}
            onChoose={chooseChatOption}
            onRecommend={() => void recommendAgain()}
          />
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") send(); }} disabled={loading || loadingChoices} placeholder="例如：第二天晚餐后新增天安门夜骑" className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-700" />
        <button onClick={send} disabled={!input.trim() || loading || loadingChoices} className="rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50">{loading || loadingChoices ? "处理中…" : "发送"}</button>
      </div>
    </section>
  );
}
