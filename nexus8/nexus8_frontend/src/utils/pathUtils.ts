import type { PathConfiguration } from '../schema';

// Path manipulation utilities
export class PathUtils {
  private config: PathConfiguration;
  
  constructor(config: PathConfiguration) {
    this.config = config;
  }
  
  // Parse path into segments
  parsePath(path: string): string[] {
    if (!path || path === this.config.rootPath) {
      return [];
    }
    
    return path
      .split(this.config.pathSeparator)
      .filter(segment => segment.length > 0 && segment !== this.config.rootPath);
  }
  
  // Build path from segments
  buildPath(segments: string[]): string {
    if (segments.length === 0) {
      return this.config.rootPath;
    }
    
    const cleanSegments = segments.filter(segment => 
      segment.length > 0 && segment !== this.config.rootPath
    );
    
    if (cleanSegments.length === 0) {
      return this.config.rootPath;
    }
    
    return this.config.rootPath + this.config.pathSeparator + cleanSegments.join(this.config.pathSeparator);
  }
  
  // Get parent path
  getParentPath(path: string): string | null {
    if (!path || path === this.config.rootPath) {
      return null;
    }
    
    const segments = this.parsePath(path);
    if (segments.length === 0) {
      return null;
    }
    
    if (segments.length === 1) {
      return this.config.rootPath;
    }
    
    segments.pop();
    return this.buildPath(segments);
  }
  
  // Get path depth
  getDepth(path: string): number {
    if (!path || path === this.config.rootPath) {
      return 0;
    }
    
    return this.parsePath(path).length;
  }
  
  // Check if path is valid
  isValidPath(path: string): boolean {
    if (!path) return false;
    
    // Check depth limit
    if (this.getDepth(path) > this.config.maxDepth) {
      return false;
    }
    
    // Check segments
    const segments = this.parsePath(path);
    for (const segment of segments) {
      if (!this.isValidSegment(segment)) {
        return false;
      }
    }
    
    return true;
  }
  
  // Check if segment is valid
  isValidSegment(segment: string): boolean {
    if (!segment || segment.length === 0) {
      return false;
    }
    
    // Check length
    if (segment.length > this.config.maxSegmentLength) {
      return false;
    }
    
    // Check allowed characters
    const allowedRegex = new RegExp(`^[${this.config.allowedCharacters}]+$`);
    return allowedRegex.test(segment);
  }
  
  // Create slug from title
  createSlugFromTitle(title: string): string {
    if (!this.config.pathFromTitle) {
      return title;
    }
    
    let slug = title;
    
    if (this.config.slugify) {
      slug = this.slugify(title);
    }
    
    // Apply character restrictions
    const allowedRegex = new RegExp(`[^${this.config.allowedCharacters}]`, 'g');
    slug = slug.replace(allowedRegex, '');
    
    // Limit length
    if (slug.length > this.config.maxSegmentLength) {
      slug = slug.substring(0, this.config.maxSegmentLength);
    }
    
    // Ensure it's not empty
    if (!slug) {
      slug = 'untitled';
    }
    
    return slug;
  }
  
  // Slugify text
  private slugify(text: string): string {
    return text
      .toString()
      .toLowerCase()
      .trim()
      // Replace spaces and underscores with hyphens
      .replace(/[\s_]+/g, '-')
      // Remove special characters (keep alphanumeric and hyphens)
      .replace(/[^\w\-]+/g, '')
      // Replace multiple hyphens with single hyphen
      .replace(/\-\-+/g, '-')
      // Remove leading and trailing hyphens
      .replace(/^-+|-+$/g, '');
  }
  
  // Join paths
  joinPaths(...paths: string[]): string {
    const segments: string[] = [];
    
    for (const path of paths) {
      if (path && path !== this.config.rootPath) {
        segments.push(...this.parsePath(path));
      }
    }
    
    return this.buildPath(segments);
  }
  
  // Get relative path between two paths
  getRelativePath(fromPath: string, toPath: string): string {
    const fromSegments = this.parsePath(fromPath);
    const toSegments = this.parsePath(toPath);
    
    // Find common ancestor
    let commonLength = 0;
    const minLength = Math.min(fromSegments.length, toSegments.length);
    
    for (let i = 0; i < minLength; i++) {
      if (fromSegments[i] === toSegments[i]) {
        commonLength++;
      } else {
        break;
      }
    }
    
    // Build relative path
    const upLevels = fromSegments.length - commonLength;
    const downSegments = toSegments.slice(commonLength);
    
    if (upLevels === 0 && downSegments.length === 0) {
      return '.'; // Same path
    }
    
    const relativeParts = [];
    for (let i = 0; i < upLevels; i++) {
      relativeParts.push('..');
    }
    relativeParts.push(...downSegments);
    
    return relativeParts.join('/');
  }
  
  // Check if one path is ancestor of another
  isAncestor(ancestorPath: string, descendantPath: string): boolean {
    if (ancestorPath === descendantPath) {
      return false; // Same path, not ancestor
    }
    
    const ancestorSegments = this.parsePath(ancestorPath);
    const descendantSegments = this.parsePath(descendantPath);
    
    if (ancestorSegments.length >= descendantSegments.length) {
      return false; // Ancestor must be shorter
    }
    
    // Check if all ancestor segments match
    for (let i = 0; i < ancestorSegments.length; i++) {
      if (ancestorSegments[i] !== descendantSegments[i]) {
        return false;
      }
    }
    
    return true;
  }
  
  // Check if one path is descendant of another
  isDescendant(descendantPath: string, ancestorPath: string): boolean {
    return this.isAncestor(ancestorPath, descendantPath);
  }
  
  // Get all ancestor paths
  getAncestorPaths(path: string): string[] {
    const segments = this.parsePath(path);
    const ancestors: string[] = [this.config.rootPath];
    
    for (let i = 1; i <= segments.length; i++) {
      ancestors.push(this.buildPath(segments.slice(0, i)));
    }
    
    return ancestors.slice(0, -1); // Exclude the path itself
  }
  
  // Get immediate children paths from a list of paths
  getChildrenPaths(parentPath: string, allPaths: string[]): string[] {
    const parentDepth = this.getDepth(parentPath);
    
    return allPaths.filter(path => {
      return this.getDepth(path) === parentDepth + 1 && 
             this.isDescendant(path, parentPath);
    });
  }
  
  // Get all descendant paths from a list of paths
  getDescendantPaths(ancestorPath: string, allPaths: string[]): string[] {
    return allPaths.filter(path => this.isDescendant(path, ancestorPath));
  }
  
  // Generate unique path when conflicts exist
  generateUniquePath(basePath: string, existingPaths: string[]): string {
    if (!existingPaths.includes(basePath)) {
      return basePath;
    }
    
    const segments = this.parsePath(basePath);
    const lastSegment = segments[segments.length - 1];
    const parentSegments = segments.slice(0, -1);
    
    let counter = 1;
    let uniquePath: string;
    
    do {
      const newLastSegment = `${lastSegment}-${counter}`;
      uniquePath = this.buildPath([...parentSegments, newLastSegment]);
      counter++;
    } while (existingPaths.includes(uniquePath) && counter < 1000); // Safety limit
    
    return uniquePath;
  }
  
  // Normalize path (ensure consistent format)
  normalizePath(path: string): string {
    if (!path) return this.config.rootPath;
    
    // Handle case sensitivity
    if (!this.config.pathCaseSensitive) {
      path = path.toLowerCase();
    }
    
    // Parse and rebuild to ensure consistent format
    const segments = this.parsePath(path);
    return this.buildPath(segments);
  }
  
  // Get path display name
  getDisplayName(path: string): string {
    if (this.config.displayNames && this.config.displayNames[path]) {
      return this.config.displayNames[path];
    }
    
    const segments = this.parsePath(path);
    if (segments.length === 0) {
      return 'Root';
    }
    
    // Return the last segment as display name
    return segments[segments.length - 1];
  }
  
  // Get path icon
  getIcon(path: string): string | undefined {
    return this.config.displayIcons?.[path];
  }
}

// Utility functions that don't require config
export const pathUtils = {
  // Simple path joining without configuration
  join: (...parts: string[]): string => {
    return parts
      .filter(part => part && part.length > 0)
      .join('/')
      .replace(/\/+/g, '/'); // Remove duplicate slashes
  },
  
  // Get filename from path
  basename: (path: string): string => {
    const parts = path.split('/');
    return parts[parts.length - 1] || '';
  },
  
  // Get directory from path
  dirname: (path: string): string => {
    const parts = path.split('/');
    parts.pop();
    return parts.join('/') || '/';
  },
  
  // Check if path is absolute
  isAbsolute: (path: string): boolean => {
    return path.startsWith('/') || path.includes('://');
  },
  
  // Resolve relative path
  resolve: (basePath: string, relativePath: string): string => {
    if (pathUtils.isAbsolute(relativePath)) {
      return relativePath;
    }
    
    const baseParts = basePath.split('/').filter(Boolean);
    const relativeParts = relativePath.split('/').filter(Boolean);
    
    const resolvedParts = [...baseParts];
    
    for (const part of relativeParts) {
      if (part === '..') {
        resolvedParts.pop();
      } else if (part !== '.') {
        resolvedParts.push(part);
      }
    }
    
    return '/' + resolvedParts.join('/');
  },
  
  // Extract path parts
  parse: (path: string): { root: string; dir: string; base: string; ext: string; name: string } => {
    const base = pathUtils.basename(path);
    const dir = pathUtils.dirname(path);
    const extIndex = base.lastIndexOf('.');
    const ext = extIndex > 0 ? base.substring(extIndex) : '';
    const name = extIndex > 0 ? base.substring(0, extIndex) : base;
    
    return {
      root: path.startsWith('/') ? '/' : '',
      dir,
      base,
      ext,
      name,
    };
  },
};

// Create path utils instance with default config
export const createPathUtils = (config: PathConfiguration): PathUtils => {
  return new PathUtils(config);
};