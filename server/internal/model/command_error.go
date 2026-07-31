package model

import "fmt"

// CommandIssueCode is a machine-readable structural validation issue code.
type CommandIssueCode string

const (
	IssueMissingField     CommandIssueCode = "missing_field"
	IssueInvalidValue     CommandIssueCode = "invalid_value"
	IssueUnknownCommand   CommandIssueCode = "unknown_command"
	IssueUnauthorized     CommandIssueCode = "unauthorized"
	IssueDuplicateRequest CommandIssueCode = "duplicate_request"
)

// CommandIssue is a field-level structural validation problem.
// Agents can repair prompts from Field/Expected without parsing free-form Message.
type CommandIssue struct {
	Code     CommandIssueCode `json:"code"`
	Field    string           `json:"field,omitempty"`
	Message  string           `json:"message"`
	Expected any              `json:"expected,omitempty"`
	Actual   any              `json:"actual,omitempty"`
}

// MissingFieldIssue builds a missing_field issue for a required path.
func MissingFieldIssue(field string) CommandIssue {
	return CommandIssue{
		Code:     IssueMissingField,
		Field:    field,
		Message:  fmt.Sprintf("%s is required", field),
		Expected: "required",
	}
}

// InvalidValueIssue builds an invalid_value issue with optional expected/actual hints.
func InvalidValueIssue(field, message string, expected, actual any) CommandIssue {
	if message == "" {
		message = fmt.Sprintf("%s has invalid value", field)
	}
	return CommandIssue{
		Code:     IssueInvalidValue,
		Field:    field,
		Message:  message,
		Expected: expected,
		Actual:   actual,
	}
}

// UnknownCommandIssue builds an unknown_command issue for type.
func UnknownCommandIssue(cmdType string) CommandIssue {
	return CommandIssue{
		Code:     IssueUnknownCommand,
		Field:    "type",
		Message:  fmt.Sprintf("unknown command type: %s", cmdType),
		Actual:   cmdType,
		Expected: "known CommandType",
	}
}

// UnauthorizedIssue builds an unauthorized permission issue.
func UnauthorizedIssue(message string) CommandIssue {
	if message == "" {
		message = "permission denied"
	}
	return CommandIssue{
		Code:    IssueUnauthorized,
		Message: message,
	}
}

// DuplicateRequestIssue builds a duplicate_request issue for request_id.
func DuplicateRequestIssue() CommandIssue {
	return CommandIssue{
		Code:     IssueDuplicateRequest,
		Field:    "request_id",
		Message:  "duplicate request_id",
		Expected: "unique request_id",
	}
}

// IssuesMessage joins issue messages into a single human-readable summary.
func IssuesMessage(issues []CommandIssue) string {
	if len(issues) == 0 {
		return ""
	}
	if len(issues) == 1 {
		return issues[0].Message
	}
	parts := make([]string, 0, len(issues))
	for _, issue := range issues {
		if issue.Message != "" {
			parts = append(parts, issue.Message)
		}
	}
	if len(parts) == 0 {
		return string(issues[0].Code)
	}
	msg := parts[0]
	for i := 1; i < len(parts); i++ {
		msg += "; " + parts[i]
	}
	return msg
}
