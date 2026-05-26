"""Project component module: parses `.sillyspec/projects/*.yaml`.

See ``tasks/task-03.md``. Models are imported eagerly so that
``BaseModel.metadata`` picks them up for autogenerate / create_all.
"""

from app.modules.component.model import ComponentRelation, ProjectComponent
from app.modules.component.router import router as component_router

__all__ = ["ComponentRelation", "ProjectComponent", "component_router"]
