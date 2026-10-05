#!/usr/bin/env python3
"""Save or reload one exact PCB document through KiCad's official IPC API."""

import json
import os
import sys


def emit(status: str, **values: object) -> None:
    print(json.dumps({"status": status, **values}))


def document_path(document: object) -> str | None:
    board_filename = getattr(document, "board_filename", "")
    project = getattr(document, "project", None)
    project_path = getattr(project, "path", "") if project else ""
    if not board_filename:
        return None
    if os.path.isabs(board_filename):
        return os.path.realpath(board_filename)
    if not project_path:
        return None
    base = project_path if os.path.isdir(project_path) else os.path.dirname(project_path)
    return os.path.realpath(os.path.join(base, board_filename))


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] not in {"save", "revert"}:
        emit("error", message="Usage: kicad-ipc-reload.py <save|revert> <board.kicad_pcb>")
        return 2

    action = sys.argv[1]
    target = os.path.realpath(sys.argv[2])
    try:
        from kipy import KiCad
        from kipy.board import Board
        from kipy.proto.common.types import DocumentType
    except ImportError:
        emit("dependency-missing", message="The official kicad-python package is not installed in this project's Python environment.")
        return 2

    try:
        kicad = KiCad(client_name="TSPCB PCB reload", timeout_ms=2500)
        documents = kicad.get_open_documents(DocumentType.DOCTYPE_PCB)
    except Exception as error:
        emit("unavailable", message=str(error))
        return 0

    open_boards = []
    matching_document = None
    for document in documents:
        resolved = document_path(document)
        if resolved:
            open_boards.append(resolved)
        if resolved == target:
            matching_document = document

    if matching_document is None:
        emit("not-open", target=target, openBoards=open_boards)
        return 0

    try:
        board = Board(kicad._client, matching_document)
        if action == "save":
            board.save()
            emit("saved", target=target)
        else:
            board.revert()
            emit("reloaded", target=target)
        return 0
    except Exception as error:
        emit("error", target=target, message=str(error))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
