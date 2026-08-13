import type { ExternalDeliveryRepository, ExternalDeliveryService } from "../ports/external-delivery.js";

export function createExternalDeliveryService(dependencies: { repository: ExternalDeliveryRepository }): ExternalDeliveryService {
  const repository = dependencies.repository;
  return {
    listDue: (input) => repository.listDue(input),
    claimReply: (input) => repository.claimReply(input),
    renewReplyLease: (input) => repository.renewReplyLease(input),
    completeReply: (input) => repository.completeReply(input),
    failReply: (input) => repository.failReply(input),
    claimControlEvent: (input) => repository.claimControlEvent(input),
    completeControlEvent: (input) => repository.completeControlEvent(input),
    listIssues: (input) => repository.listIssues(input),
    countIssues: () => repository.countIssues(),
    resolveIssue: (input) => repository.resolveIssue(input),
    recoverStaleClaims: (input) => repository.recoverStaleClaims(input),
  };
}
